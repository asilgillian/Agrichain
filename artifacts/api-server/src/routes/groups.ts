import { Router, type IRouter } from "express";
import { eq, and, or, sql, inArray, desc, isNull, ne } from "drizzle-orm";
import {
  db,
  groupsTable,
  groupLeadersTable,
  groupTransfersTable,
  groupRegionsTable,
  farmersTable,
  plotsTable,
  deliveriesTable,
  batchesTable,
  auditLogsTable,
  userGroupsTable,
  regionsTable,
} from "@workspace/db";
import { CreateGroupBody, ListGroupsQueryParams } from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { validateGroupRegionAnchor, deriveGroupAdminColumnsFromRegion } from "../lib/region-validation";
import { getDistrictAncestorIdsBatch, getGroupDistrictIds, getGroupDistrictIdsBatch } from "../lib/org-region-scope";
import { checkGroupAccess, isUserScoped, getAssignedGroupIds } from "../lib/assignment-scope";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP_TYPES = new Set(["cooperative", "association", "producer_group"]);

/**
 * Parse + validate the `districtIds` array on create/update bodies. Falls back
 * to a single-element array containing `legacyRegionId` when the caller still
 * sends the old `{ regionId }` field. Returns `{ ids }` on success or
 * `{ error }` with an HTTP-ready message on failure.
 *
 * Each id must be a valid uuid AND a District-level region for its country
 * (validateGroupRegionAnchor). Empty arrays are rejected.
 */
async function parseDistrictIds(body: Record<string, unknown>, legacyRegionId?: string | null): Promise<{ ids: string[] } | { error: string }> {
  let raw: unknown = body.districtIds;
  if (raw === undefined && legacyRegionId) raw = [legacyRegionId];
  if (!Array.isArray(raw) || raw.length === 0) return { error: "districtIds must be a non-empty array" };
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (typeof x !== "string" || !UUID_RE.test(x)) return { error: "districtIds contains an invalid uuid" };
    if (seen.has(x)) continue;
    seen.add(x);
    ids.push(x);
  }
  for (const id of ids) {
    const err = await validateGroupRegionAnchor(id);
    if (err) return { error: `Invalid district ${id}: ${err}` };
  }
  return { ids };
}

/** Replace the group_regions set for a group inside a transaction. Caller is
 * responsible for ensuring `districtIds` is non-empty and validated. */
async function replaceGroupRegions(tx: any, groupId: string, districtIds: string[]) {
  await tx.delete(groupRegionsTable).where(eq(groupRegionsTable.groupId, groupId));
  for (const regionId of districtIds) {
    await tx.insert(groupRegionsTable).values({ groupId, regionId });
  }
}

// ------------- helpers -------------

async function computeKpis(groupIds: string[]): Promise<Record<string, { memberCount: number; activePlots: number; procurementVolumeKg: number; complianceScore: number }>> {
  if (groupIds.length === 0) return {};
  const out: Record<string, any> = {};
  for (const id of groupIds) out[id] = { memberCount: 0, activePlots: 0, procurementVolumeKg: 0, complianceScore: 0.85 };

  const memberRows = await db
    .select({ groupId: farmersTable.groupId, count: sql<number>`count(*)::int` })
    .from(farmersTable)
    .where(inArray(farmersTable.groupId, groupIds))
    .groupBy(farmersTable.groupId);
  for (const r of memberRows) out[r.groupId].memberCount = r.count ?? 0;

  const plotRows = await db
    .select({ groupId: farmersTable.groupId, count: sql<number>`count(*)::int` })
    .from(plotsTable)
    .leftJoin(farmersTable, eq(plotsTable.farmerId, farmersTable.id))
    .where(and(inArray(farmersTable.groupId, groupIds), eq(plotsTable.status, "active")))
    .groupBy(farmersTable.groupId);
  for (const r of plotRows) if (r.groupId) out[r.groupId].activePlots = r.count ?? 0;

  // Procurement volume = sum(net kg) on approved deliveries for batches linked to this group.
  const volRows = await db
    .select({ groupId: batchesTable.groupId, kg: sql<number>`coalesce(sum(${deliveriesTable.netWeightKg}),0)::float` })
    .from(deliveriesTable)
    .leftJoin(batchesTable, eq(deliveriesTable.batchId, batchesTable.id))
    .where(and(inArray(batchesTable.groupId, groupIds), eq(deliveriesTable.status, "approved")))
    .groupBy(batchesTable.groupId);
  for (const r of volRows) if (r.groupId) out[r.groupId].procurementVolumeKg = r.kg ?? 0;

  return out;
}

function shapeGroup(g: typeof groupsTable.$inferSelect, kpis?: any) {
  return { ...g, memberCount: kpis?.memberCount ?? 0, activePlots: kpis?.activePlots ?? 0, procurementVolumeKg: kpis?.procurementVolumeKg ?? 0, complianceScore: kpis?.complianceScore ?? 0.85 };
}

async function audit(entityId: string, action: string, user: AuthedRequest["authedUser"] | undefined, data: Record<string, unknown>, before?: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({
    entityType: "group", entityId, action,
    actorId: user?.id ?? "system", actorName: user?.email ?? "system", actorRole: user?.role ?? "system",
    before: before ?? null, after: data,
  });
}

// ------------- LIST / CREATE / READ -------------

router.get("/groups", requirePermission("groups.read"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ListGroupsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { regionId } = parsed.data;
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  // Default behaviour: hide archived groups unless caller explicitly asks
  // for them (?status=archived or ?status=all).
  const statusFilter = rawStatus ?? "active";
  const parentId = typeof req.query.parentGroupId === "string" ? req.query.parentGroupId : undefined;

  const conditions: any[] = [];
  if (regionId) {
    // Multi-district: a group matches if the requested district is in its
    // covered set, not only when it's the primary anchor.
    const rows = await db
      .select({ groupId: groupRegionsTable.groupId })
      .from(groupRegionsTable)
      .where(eq(groupRegionsTable.regionId, regionId));
    const matchingGroupIds = rows.map(r => r.groupId);
    if (matchingGroupIds.length === 0) { res.json([]); return; }
    conditions.push(inArray(groupsTable.id, matchingGroupIds));
  }
  if (statusFilter !== "all") conditions.push(eq(groupsTable.status, statusFilter));
  if (parentId === "null") conditions.push(isNull(groupsTable.parentGroupId));
  else if (parentId && UUID_RE.test(parentId)) conditions.push(eq(groupsTable.parentGroupId, parentId));

  // Per-user assignment scoping. Field staff with `groups.assigned_only` only
  // see groups listed in their user_groups rows. Wildcard (*) bypasses scoping.
  const perms = req.authedUser?.permissions ?? [];
  const scoped = perms.includes("groups.assigned_only") && !perms.includes("*");
  if (scoped) {
    const assigned = await db
      .select({ groupId: userGroupsTable.groupId })
      .from(userGroupsTable)
      .where(eq(userGroupsTable.userId, req.authedUser!.id));
    const ids = assigned.map(a => a.groupId);
    if (ids.length === 0) {
      res.json([]); // assigned-only with no assignments = empty
      return;
    }
    conditions.push(inArray(groupsTable.id, ids));
  }

  const groups = conditions.length
    ? await db.select().from(groupsTable).where(and(...conditions))
    : await db.select().from(groupsTable);

  const groupIds = groups.map(g => g.id);
  const [kpis, districtSets] = await Promise.all([
    computeKpis(groupIds),
    getGroupDistrictIdsBatch(groupIds),
  ]);
  // Collect all district region ids referenced by any group so we can return
  // {id, name} pairs in one extra query.
  const allDistrictIds = new Set<string>();
  for (const s of districtSets.values()) for (const id of s) allDistrictIds.add(id);
  const districtNameRows = allDistrictIds.size > 0
    ? await db.select({ id: regionsTable.id, name: regionsTable.name }).from(regionsTable).where(inArray(regionsTable.id, Array.from(allDistrictIds)))
    : [];
  const nameById = new Map(districtNameRows.map(r => [r.id, r.name]));
  res.json(groups.map(g => ({
    ...shapeGroup(g, kpis[g.id]),
    districts: Array.from(districtSets.get(g.id) ?? new Set<string>()).map(id => ({ id, name: nameById.get(id) ?? "" })),
  })));
});

router.post("/groups", requirePermission("groups.write"), async (req: AuthedRequest, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  // New districts-only model: a group covers one or more District-level
  // regions. Falls back to single-element [regionId] for legacy callers.
  // Resolve districtIds first so we can synthesize the legacy `regionId`
  // field that CreateGroupBody (generated from the old OpenAPI spec) still
  // requires. New web/mobile clients send only `districtIds[]`.
  const legacyRegionId = typeof body.regionId === "string" ? body.regionId : null;
  const dParse = await parseDistrictIds(body, legacyRegionId);
  if ("error" in dParse) { res.status(400).json({ error: dParse.error }); return; }
  const districtIds = dParse.ids;
  const parsed = CreateGroupBody.safeParse({ ...body, regionId: districtIds[0] });
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  // Primary anchor = first district. Powers denormalised village/parish/etc.
  const primaryDistrictId = districtIds[0];
  const derived = await deriveGroupAdminColumnsFromRegion(primaryDistrictId);
  const extras: Record<string, unknown> = { ...derived };
  for (const f of ["village", "parish", "subCounty", "district"] as const) {
    if (typeof body[f] === "string" && (body[f] as string).trim()) extras[f] = (body[f] as string).trim();
  }
  if (typeof body.groupType === "string" && GROUP_TYPES.has(body.groupType)) extras.groupType = body.groupType;
  if (body.parentGroupId !== undefined && body.parentGroupId !== null) {
    if (typeof body.parentGroupId !== "string" || !UUID_RE.test(body.parentGroupId)) {
      res.status(400).json({ error: "Invalid parentGroupId" }); return;
    }
    const parentDenied = await checkGroupAccess(body.parentGroupId, req.authedUser);
    if (parentDenied) { res.status(parentDenied.status).json({ error: parentDenied.error }); return; }
    const [parent] = await db.select().from(groupsTable).where(eq(groupsTable.id, body.parentGroupId));
    if (!parent) { res.status(400).json({ error: "Parent group not found" }); return; }
    if (parent.status === "archived") { res.status(400).json({ error: "Parent group is archived" }); return; }
    extras.parentGroupId = body.parentGroupId;
  }

  const group = await db.transaction(async (tx) => {
    const [g] = await tx.insert(groupsTable).values({ ...parsed.data, regionId: primaryDistrictId, ...extras }).returning();
    await replaceGroupRegions(tx, g.id, districtIds);
    return g;
  });
  await audit(group.id, "group.create", req.authedUser, { name: group.name, regionId: group.regionId, districtIds, groupType: group.groupType, parentGroupId: group.parentGroupId });
  res.status(201).json({
    ...shapeGroup(group, { memberCount: 0, activePlots: 0, procurementVolumeKg: 0, complianceScore: 0 }),
    districts: districtIds.map(id => ({ id, name: "" })),
  });
});

router.patch("/groups/:groupId", requirePermission("groups.write"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [current] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!current) { res.status(404).json({ error: "Group not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  // Multi-district edit. Either send `districtIds: string[]` to replace the
  // full set, or the legacy `regionId: string` to set a single-district
  // primary anchor (kept for back-compat with older clients).
  let nextDistrictIds: string[] | null = null;
  if (Array.isArray(body.districtIds) || typeof body.regionId === "string") {
    const dParse = await parseDistrictIds(body, typeof body.regionId === "string" ? body.regionId : null);
    if ("error" in dParse) { res.status(400).json({ error: dParse.error }); return; }
    nextDistrictIds = dParse.ids;
    patch.regionId = nextDistrictIds[0];
    const derived = await deriveGroupAdminColumnsFromRegion(nextDistrictIds[0]);
    Object.assign(patch, derived);
  }
  for (const f of ["name", "village", "parish", "subCounty", "district"] as const) {
    if (typeof body[f] === "string") patch[f] = (body[f] as string).trim() || null;
  }
  if (typeof body.groupType === "string") {
    if (!GROUP_TYPES.has(body.groupType)) { res.status(400).json({ error: "Invalid groupType" }); return; }
    patch.groupType = body.groupType;
  }
  if (body.parentGroupId === null) patch.parentGroupId = null;
  else if (body.parentGroupId !== undefined) {
    if (typeof body.parentGroupId !== "string" || !UUID_RE.test(body.parentGroupId)) {
      res.status(400).json({ error: "Invalid parentGroupId" }); return;
    }
    if (body.parentGroupId === groupId) { res.status(400).json({ error: "Group cannot be its own parent" }); return; }
    // Per-user assignment scoping: scoped users may only re-parent under a group
    // they're assigned to.
    const parentDenied = await checkGroupAccess(body.parentGroupId, req.authedUser);
    if (parentDenied) { res.status(parentDenied.status).json({ error: parentDenied.error }); return; }
    const [parentRow] = await db.select().from(groupsTable).where(eq(groupsTable.id, body.parentGroupId));
    if (!parentRow) { res.status(400).json({ error: "Parent group not found" }); return; }
    if (parentRow.status === "archived") { res.status(400).json({ error: "Parent group is archived" }); return; }
    // Cycle prevention: ensure candidate parent doesn't have this group anywhere in its ancestry.
    let cursor: string | null = parentRow.parentGroupId;
    const seen = new Set<string>([groupId, body.parentGroupId]);
    while (cursor) {
      if (seen.has(cursor)) { res.status(400).json({ error: "Parent link would create a cycle" }); return; }
      seen.add(cursor);
      const [p]: any[] = await db.select({ parentGroupId: groupsTable.parentGroupId }).from(groupsTable).where(eq(groupsTable.id, cursor));
      cursor = p?.parentGroupId ?? null;
    }
    patch.parentGroupId = body.parentGroupId;
  }

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(groupsTable).set(patch).where(eq(groupsTable.id, groupId)).returning();
    if (nextDistrictIds) await replaceGroupRegions(tx, groupId, nextDistrictIds);
    return u;
  });
  await audit(groupId, "group.update", req.authedUser, { ...patch, ...(nextDistrictIds ? { districtIds: nextDistrictIds } : {}) }, { ...current });
  res.json(shapeGroup(updated));
});

// ------------- COVERED DISTRICTS (multi) -------------

router.get("/groups/:groupId/districts", requirePermission("groups.read"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const ids = Array.from(await getGroupDistrictIds(groupId));
  if (ids.length === 0) { res.json([]); return; }
  const rows = await db.select({ id: regionsTable.id, name: regionsTable.name, countryCode: regionsTable.countryCode })
    .from(regionsTable).where(inArray(regionsTable.id, ids));
  res.json(rows);
});

router.put("/groups/:groupId/districts", requirePermission("groups.write"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [current] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!current) { res.status(404).json({ error: "Group not found" }); return; }
  const dParse = await parseDistrictIds(req.body as Record<string, unknown>);
  if ("error" in dParse) { res.status(400).json({ error: dParse.error }); return; }
  const ids = dParse.ids;
  // Removing a district that still has resident farmers would silently
  // unscope them. Reject with a list of farmer ids the admin must move first.
  const beforeSet = await getGroupDistrictIds(groupId);
  const removed = Array.from(beforeSet).filter(x => !ids.includes(x));
  if (removed.length > 0) {
    const members = await db.select({ id: farmersTable.id, regionId: farmersTable.regionId })
      .from(farmersTable).where(eq(farmersTable.groupId, groupId));
    const checkable = members.filter(m => m.regionId);
    const districtMap = await getDistrictAncestorIdsBatch(checkable.map(m => m.regionId as string));
    const stranded: string[] = [];
    for (const m of checkable) {
      const d = districtMap.get(m.regionId as string);
      if (d && removed.includes(d)) stranded.push(m.id);
    }
    if (stranded.length > 0) {
      res.status(400).json({
        error: "Cannot remove districts that still have member farmers",
        code: "REMOVE_DISTRICT_HAS_FARMERS",
        farmerIds: stranded,
      });
      return;
    }
  }
  const primary = ids[0];
  const derived = await deriveGroupAdminColumnsFromRegion(primary);
  await db.transaction(async (tx) => {
    await tx.update(groupsTable).set({ regionId: primary, ...derived, updatedAt: new Date() }).where(eq(groupsTable.id, groupId));
    await replaceGroupRegions(tx, groupId, ids);
  });
  await audit(groupId, "group.districts.replace", req.authedUser, { districtIds: ids }, { regionId: current.regionId });
  const rows = await db.select({ id: regionsTable.id, name: regionsTable.name }).from(regionsTable).where(inArray(regionsTable.id, ids));
  res.json(rows);
});

router.get("/groups/:groupId", requirePermission("groups.read"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const members = await db.select().from(farmersTable).where(eq(farmersTable.groupId, groupId));
  const leaders = await db.select({
    id: groupLeadersTable.id, groupId: groupLeadersTable.groupId, farmerId: groupLeadersTable.farmerId,
    position: groupLeadersTable.position, termStart: groupLeadersTable.termStart, termEnd: groupLeadersTable.termEnd,
    status: groupLeadersTable.status, farmerFirstName: farmersTable.firstName, farmerLastName: farmersTable.lastName,
    farmerRef: farmersTable.referenceNumber,
  }).from(groupLeadersTable)
    .leftJoin(farmersTable, eq(groupLeadersTable.farmerId, farmersTable.id))
    .where(eq(groupLeadersTable.groupId, groupId))
    .orderBy(desc(groupLeadersTable.termStart));

  // Filter parent/children visibility by assignment for scoped users — they may
  // be assigned to THIS group without being assigned to its relatives.
  const scoped = isUserScoped(req.authedUser);
  const callerAssigned = scoped ? await getAssignedGroupIds(req.authedUser!.id) : null;
  const [parent] = group.parentGroupId && (!callerAssigned || callerAssigned.has(group.parentGroupId))
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, group.parentGroupId))
    : [null];
  const allChildren = await db.select().from(groupsTable).where(eq(groupsTable.parentGroupId, groupId));
  const children = callerAssigned
    ? allChildren.filter(c => callerAssigned.has(c.id))
    : allChildren;

  const transfers = await db.select().from(groupTransfersTable)
    .where(or(eq(groupTransfersTable.toGroupId, groupId), eq(groupTransfersTable.fromGroupId, groupId)))
    .orderBy(desc(groupTransfersTable.transferredAt))
    .limit(50);

  const kpis = await computeKpis([groupId]);
  const districtIdSet = await getGroupDistrictIds(groupId);
  const districtIds = Array.from(districtIdSet);
  const districtRows = districtIds.length > 0
    ? await db.select({ id: regionsTable.id, name: regionsTable.name }).from(regionsTable).where(inArray(regionsTable.id, districtIds))
    : [];
  res.json({
    ...shapeGroup(group, kpis[groupId]),
    districts: districtRows,
    parent,
    children,
    members: members.map(m => ({ ...m, groupName: group.name })),
    leaders,
    transfers,
  });
});

// ------------- LEADERSHIP -------------

router.post("/groups/:groupId/leaders", requirePermission("groups.leaders.write"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const { farmerId, position, termStart, termEnd } = req.body ?? {};
  if (!UUID_RE.test(String(farmerId ?? ""))) { res.status(400).json({ error: "farmerId required" }); return; }
  if (typeof position !== "string" || !position.trim()) { res.status(400).json({ error: "position required" }); return; }
  if (typeof termStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(termStart)) { res.status(400).json({ error: "termStart (YYYY-MM-DD) required" }); return; }

  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId));
  if (!farmer || farmer.groupId !== groupId) { res.status(400).json({ error: "Farmer must be a member of the group" }); return; }

  const today = new Date().toISOString().slice(0, 10);
  const leader = await db.transaction(async (tx) => {
    // End any existing active leader for this position before appointing a new one — audit each implicit end.
    const ending = await tx.select().from(groupLeadersTable)
      .where(and(eq(groupLeadersTable.groupId, groupId), eq(groupLeadersTable.position, position.trim()), eq(groupLeadersTable.status, "active")));
    if (ending.length > 0) {
      await tx.update(groupLeadersTable)
        .set({ status: "ended", termEnd: today, updatedAt: new Date() })
        .where(and(eq(groupLeadersTable.groupId, groupId), eq(groupLeadersTable.position, position.trim()), eq(groupLeadersTable.status, "active")));
      for (const prev of ending) {
        await tx.insert(auditLogsTable).values({
          entityType: "group", entityId: groupId, action: "leader.end",
          actorId: req.authedUser?.id ?? "system", actorName: req.authedUser?.email ?? "system", actorRole: req.authedUser?.role ?? "system",
          before: { leaderId: prev.id, position: prev.position, farmerId: prev.farmerId, status: "active" },
          after: { leaderId: prev.id, status: "ended", termEnd: today, reason: "superseded_by_new_appointment" },
        });
      }
    }
    const [created] = await tx.insert(groupLeadersTable).values({
      groupId, farmerId, position: position.trim(), termStart,
      termEnd: typeof termEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(termEnd) ? termEnd : null,
      status: "active",
    }).returning();
    await tx.insert(auditLogsTable).values({
      entityType: "group", entityId: groupId, action: "leader.appoint",
      actorId: req.authedUser?.id ?? "system", actorName: req.authedUser?.email ?? "system", actorRole: req.authedUser?.role ?? "system",
      before: null, after: { leaderId: created.id, position: created.position, farmerId, termStart, termEnd },
    });
    return created;
  });
  res.status(201).json(leader);
});

router.patch("/groups/:groupId/leaders/:leaderId/end", requirePermission("groups.leaders.write"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string; const leaderId = req.params.leaderId as string;
  if (!UUID_RE.test(groupId) || !UUID_RE.test(leaderId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const termEnd = typeof req.body?.termEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.termEnd)
    ? req.body.termEnd : new Date().toISOString().slice(0, 10);
  const [updated] = await db.update(groupLeadersTable)
    .set({ status: "ended", termEnd, updatedAt: new Date() })
    .where(and(eq(groupLeadersTable.id, leaderId), eq(groupLeadersTable.groupId, groupId), eq(groupLeadersTable.status, "active")))
    .returning();
  if (!updated) { res.status(404).json({ error: "Active leader not found" }); return; }
  await audit(groupId, "leader.end", req.authedUser, { leaderId, termEnd });
  res.json(updated);
});

// ------------- TRANSFERS (single + bulk) -------------

router.post("/groups/:toGroupId/transfer", requirePermission("groups.transfer"), async (req: AuthedRequest, res): Promise<void> => {
  const toGroupId = req.params.toGroupId as string;
  if (!UUID_RE.test(toGroupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(toGroupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const rawIds: unknown[] = Array.isArray(req.body?.farmerIds) ? req.body.farmerIds : [];
  if (rawIds.length === 0) { res.status(400).json({ error: "farmerIds array required" }); return; }
  // Strict validation — reject the whole batch if any id is malformed (audit-grade input).
  const invalidIds = rawIds.filter(x => typeof x !== "string" || !UUID_RE.test(x as string));
  if (invalidIds.length > 0) { res.status(400).json({ error: "Invalid farmerId(s) in batch", invalidIds }); return; }
  const farmerIds = rawIds as string[];
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) { res.status(400).json({ error: "reason required for audit trail" }); return; }

  const [target] = await db.select().from(groupsTable).where(eq(groupsTable.id, toGroupId));
  if (!target || target.status !== "active") { res.status(400).json({ error: "Target group not found or archived" }); return; }

  const result = await db.transaction(async (tx) => {
    const farmers = await tx.select().from(farmersTable).where(inArray(farmersTable.id, farmerIds));
    if (farmers.length !== farmerIds.length) {
      return { error: "One or more farmers not found" as const };
    }
    // Per-user assignment scoping: a scoped user must also be assigned to EVERY
    // source group, not just the destination. Otherwise they could yank farmers
    // out of groups they aren't supposed to see.
    if (isUserScoped(req.authedUser)) {
      const assigned = await getAssignedGroupIds(req.authedUser!.id);
      // Treat orphan farmers (groupId null) as unauthorized for scoped users —
      // they wouldn't be visible via the normal farmer endpoints either.
      const unauthorized = farmers.filter(f => !f.groupId || !assigned.has(f.groupId));
      if (unauthorized.length > 0) {
        return { error: "You are not assigned to one or more source groups" as const, status: 403 as const };
      }
    }
    const sameGroup = farmers.filter(f => f.groupId === toGroupId);
    if (sameGroup.length === farmers.length) {
      return { error: "All selected farmers are already in the target group" as const };
    }
    // Org-region consistency: every farmer being moved must live in a village
    // that sits inside one of the destination group's covered districts. With
    // multi-district groups, the check becomes "is the farmer's district in
    // the group's district SET" (instead of equality with a single anchor).
    const targetDistricts = await getGroupDistrictIds(toGroupId);
    const movableFarmers = farmers.filter(f => f.groupId !== toGroupId && f.regionId);
    const districtMap = await getDistrictAncestorIdsBatch(
      movableFarmers.map(f => f.regionId as string),
    );
    const districtMismatches: string[] = [];
    for (const f of movableFarmers) {
      const fd = districtMap.get(f.regionId as string) ?? null;
      if (targetDistricts.size === 0 || !fd || !targetDistricts.has(fd)) districtMismatches.push(f.id);
    }
    if (districtMismatches.length > 0) {
      return {
        error: "One or more farmers live in a different district than the target group" as const,
        status: 400 as const,
        code: "TRANSFER_DISTRICT_MISMATCH" as const,
        farmerIds: districtMismatches,
      };
    }
    const moved: string[] = [];
    for (const f of farmers) {
      if (f.groupId === toGroupId) continue;
      await tx.update(farmersTable).set({ groupId: toGroupId, updatedAt: new Date() }).where(eq(farmersTable.id, f.id));
      await tx.insert(groupTransfersTable).values({
        farmerId: f.id, fromGroupId: f.groupId, toGroupId, reason,
        kind: farmerIds.length > 1 ? "bulk_reassign" : "transfer",
        actorId: req.authedUser?.id ?? null, actorName: req.authedUser?.email ?? null,
      });
      await tx.insert(auditLogsTable).values({
        entityType: "farmer", entityId: f.id, action: "group.transfer",
        actorId: req.authedUser?.id ?? "system", actorName: req.authedUser?.email ?? "system", actorRole: req.authedUser?.role ?? "system",
        before: { groupId: f.groupId }, after: { groupId: toGroupId, reason },
      });
      moved.push(f.id);
    }
    return { moved };
  });
  if ("error" in result) {
    const r = result as { error: string; status?: number; code?: string; farmerIds?: string[] };
    const status = r.status ?? 400;
    const body: Record<string, unknown> = { error: r.error };
    if (r.code) body.code = r.code;
    if (r.farmerIds) body.farmerIds = r.farmerIds;
    res.status(status).json(body);
    return;
  }
  res.json({ movedCount: result.moved.length, farmerIds: result.moved, toGroupId });
});

// ------------- ARCHIVE (deactivate + redistribute) -------------

router.post("/groups/:groupId/archive", requirePermission("groups.archive"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const redistributeTo: string | null = typeof req.body?.redistributeToGroupId === "string" && UUID_RE.test(req.body.redistributeToGroupId)
    ? req.body.redistributeToGroupId : null;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "archive";

  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }
  if (group.status === "archived") { res.status(409).json({ error: "Group already archived" }); return; }

  const members = await db.select().from(farmersTable).where(eq(farmersTable.groupId, groupId));
  if (members.length > 0 && !redistributeTo) {
    res.status(400).json({ error: "redistributeToGroupId required — group has active members", memberCount: members.length });
    return;
  }
  if (redistributeTo) {
    if (redistributeTo === groupId) { res.status(400).json({ error: "Cannot redistribute members to the same group" }); return; }
    // Per-user assignment scoping: redistribution destination must also be in the
    // caller's assigned set when scoped — otherwise farmers could be moved into
    // groups the caller cannot otherwise see.
    const denied2 = await checkGroupAccess(redistributeTo, req.authedUser);
    if (denied2) { res.status(denied2.status).json({ error: denied2.error }); return; }
    const [target] = await db.select().from(groupsTable).where(eq(groupsTable.id, redistributeTo));
    if (!target || target.status !== "active") { res.status(400).json({ error: "Redistribute target not found or archived" }); return; }
    // Org-region consistency: every member being redistributed must live in
    // a village whose district is in the redistribute target's covered set.
    const targetDistricts = await getGroupDistrictIds(redistributeTo);
    const checkable = members.filter(m => m.regionId);
    const districtMap = await getDistrictAncestorIdsBatch(
      checkable.map(m => m.regionId as string),
    );
    const districtMismatches: string[] = [];
    for (const f of checkable) {
      const fd = districtMap.get(f.regionId as string) ?? null;
      if (targetDistricts.size === 0 || !fd || !targetDistricts.has(fd)) districtMismatches.push(f.id);
    }
    if (districtMismatches.length > 0) {
      res.status(400).json({
        error: "One or more members live in a different district than the redistribute target — move them individually first",
        code: "REDISTRIBUTE_DISTRICT_MISMATCH",
        farmerIds: districtMismatches,
      });
      return;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const actorId = req.authedUser?.id ?? "system";
  const actorName = req.authedUser?.email ?? "system";
  const actorRole = req.authedUser?.role ?? "system";

  const result = await db.transaction(async (tx) => {
    // Re-read members inside the transaction to avoid TOCTOU drift under concurrency.
    const liveMembers = await tx.select().from(farmersTable).where(eq(farmersTable.groupId, groupId));
    if (liveMembers.length > 0 && !redistributeTo) {
      throw new Error("MEMBERS_REQUIRE_REDISTRIBUTION");
    }

    let movedCount = 0;
    if (redistributeTo && liveMembers.length > 0) {
      for (const f of liveMembers) {
        await tx.update(farmersTable).set({ groupId: redistributeTo, updatedAt: new Date() }).where(eq(farmersTable.id, f.id));
        await tx.insert(groupTransfersTable).values({
          farmerId: f.id, fromGroupId: groupId, toGroupId: redistributeTo, reason,
          kind: "archive_redistribute",
          actorId: req.authedUser?.id ?? null, actorName: req.authedUser?.email ?? null,
        });
        await tx.insert(auditLogsTable).values({
          entityType: "farmer", entityId: f.id, action: "group.transfer",
          actorId, actorName, actorRole,
          before: { groupId }, after: { groupId: redistributeTo, reason: `archive: ${reason}` },
        });
        movedCount++;
      }
    }

    // End all active leaders — audit each implicit termination.
    const endingLeaders = await tx.select().from(groupLeadersTable)
      .where(and(eq(groupLeadersTable.groupId, groupId), eq(groupLeadersTable.status, "active")));
    if (endingLeaders.length > 0) {
      await tx.update(groupLeadersTable)
        .set({ status: "ended", termEnd: today, updatedAt: new Date() })
        .where(and(eq(groupLeadersTable.groupId, groupId), eq(groupLeadersTable.status, "active")));
      for (const lead of endingLeaders) {
        await tx.insert(auditLogsTable).values({
          entityType: "group", entityId: groupId, action: "leader.end",
          actorId, actorName, actorRole,
          before: { leaderId: lead.id, position: lead.position, farmerId: lead.farmerId, status: "active" },
          after: { leaderId: lead.id, status: "ended", termEnd: today, reason: "group_archived" },
        });
      }
    }

    const [archived] = await tx.update(groupsTable)
      .set({ status: "archived", archivedAt: new Date(), archivedById: req.authedUser?.id ?? null, updatedAt: new Date() })
      .where(eq(groupsTable.id, groupId))
      .returning();

    await tx.insert(auditLogsTable).values({
      entityType: "group", entityId: groupId, action: "group.archive",
      actorId, actorName, actorRole,
      before: { status: "active", memberCount: liveMembers.length },
      after: { status: "archived", redistributeToGroupId: redistributeTo, redistributedCount: movedCount, leadersEnded: endingLeaders.length, reason },
    });

    return { archived, redistributedCount: movedCount };
  }).catch((err) => {
    if (err?.message === "MEMBERS_REQUIRE_REDISTRIBUTION") return { error: "MEMBERS_REQUIRE_REDISTRIBUTION" as const };
    throw err;
  });

  if ("error" in result) {
    res.status(400).json({ error: "redistributeToGroupId required — group has active members" });
    return;
  }
  res.json({ ...shapeGroup(result.archived), redistributedCount: result.redistributedCount });
});

// ------------- REPORT (CSV for agents/auditors/cert bodies) -------------

router.get("/groups/:groupId/report", requirePermission("groups.read"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const denied = await checkGroupAccess(groupId, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(404).json({ error: "Group not found" }); return; }

  const members = await db.select().from(farmersTable).where(eq(farmersTable.groupId, groupId));
  const farmerIds = members.map(m => m.id);
  const plots = farmerIds.length > 0
    ? await db.select().from(plotsTable).where(inArray(plotsTable.farmerId, farmerIds))
    : [];
  const kpis = await computeKpis([groupId]);

  const esc = (v: unknown) => { if (v == null) return ""; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines: string[] = [];
  const districtIds = Array.from(await getGroupDistrictIds(groupId));
  const districtRows = districtIds.length > 0
    ? await db.select({ id: regionsTable.id, name: regionsTable.name }).from(regionsTable).where(inArray(regionsTable.id, districtIds))
    : [];
  const districtsLabel = districtRows.map(r => r.name).filter(Boolean).join("; ") || (group.district ?? "");
  lines.push(`Group Report,${esc(group.name)}`);
  lines.push(`Generated,${new Date().toISOString()}`);
  lines.push(`Districts covered,${esc(districtsLabel)}`);
  lines.push(`Type,${esc(group.groupType)}`);
  lines.push(`Status,${esc(group.status)}`);
  lines.push(`Members,${kpis[groupId]?.memberCount ?? 0}`);
  lines.push(`Active Plots,${kpis[groupId]?.activePlots ?? 0}`);
  lines.push(`Procurement Volume (kg),${kpis[groupId]?.procurementVolumeKg ?? 0}`);
  lines.push(`Compliance Score,${((kpis[groupId]?.complianceScore ?? 0) * 100).toFixed(1)}%`);
  lines.push("");
  lines.push("Ref #,First Name,Last Name,Phone,Village,Status,Plot Count,Total Area (ha)");
  for (const m of members) {
    const mPlots = plots.filter(p => p.farmerId === m.id);
    const area = mPlots.reduce((s, p) => s + parseFloat(p.areaHectares ?? "0"), 0);
    lines.push([m.referenceNumber, m.firstName, m.lastName, m.phoneNumber ?? "", m.village ?? "", m.status, mPlots.length, area.toFixed(4)].map(esc).join(","));
  }
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="group-${group.name.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join("\n"));
});

export default router;
