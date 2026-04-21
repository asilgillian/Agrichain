import { Router, type IRouter } from "express";
import { eq, and, or, sql, inArray, desc, isNull, ne } from "drizzle-orm";
import {
  db,
  groupsTable,
  groupLeadersTable,
  groupTransfersTable,
  farmersTable,
  plotsTable,
  deliveriesTable,
  batchesTable,
  auditLogsTable,
} from "@workspace/db";
import { CreateGroupBody, ListGroupsQueryParams } from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUP_TYPES = new Set(["cooperative", "association", "producer_group"]);

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

router.get("/groups", requirePermission("groups.read"), async (req, res): Promise<void> => {
  const parsed = ListGroupsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { regionId } = parsed.data;
  const statusFilter = typeof req.query.status === "string" ? req.query.status : undefined;
  const parentId = typeof req.query.parentGroupId === "string" ? req.query.parentGroupId : undefined;

  const conditions: any[] = [];
  if (regionId) conditions.push(eq(groupsTable.regionId, regionId));
  if (statusFilter) conditions.push(eq(groupsTable.status, statusFilter));
  if (parentId === "null") conditions.push(isNull(groupsTable.parentGroupId));
  else if (parentId && UUID_RE.test(parentId)) conditions.push(eq(groupsTable.parentGroupId, parentId));

  const groups = conditions.length
    ? await db.select().from(groupsTable).where(and(...conditions))
    : await db.select().from(groupsTable);

  const kpis = await computeKpis(groups.map(g => g.id));
  res.json(groups.map(g => shapeGroup(g, kpis[g.id])));
});

router.post("/groups", requirePermission("groups.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = req.body as Record<string, unknown>;
  const extras: Record<string, unknown> = {};
  for (const f of ["parish", "subCounty", "district"] as const) {
    if (typeof body[f] === "string" && (body[f] as string).trim()) extras[f] = (body[f] as string).trim();
  }
  if (typeof body.groupType === "string" && GROUP_TYPES.has(body.groupType)) extras.groupType = body.groupType;
  if (body.parentGroupId !== undefined && body.parentGroupId !== null) {
    if (typeof body.parentGroupId !== "string" || !UUID_RE.test(body.parentGroupId)) {
      res.status(400).json({ error: "Invalid parentGroupId" }); return;
    }
    const [parent] = await db.select().from(groupsTable).where(eq(groupsTable.id, body.parentGroupId));
    if (!parent) { res.status(400).json({ error: "Parent group not found" }); return; }
    if (parent.status === "archived") { res.status(400).json({ error: "Parent group is archived" }); return; }
    extras.parentGroupId = body.parentGroupId;
  }

  const [group] = await db.insert(groupsTable).values({ ...parsed.data, ...extras }).returning();
  await audit(group.id, "group.create", req.authedUser, { name: group.name, regionId: group.regionId, groupType: group.groupType, parentGroupId: group.parentGroupId });
  res.status(201).json(shapeGroup(group, { memberCount: 0, activePlots: 0, procurementVolumeKg: 0, complianceScore: 0 }));
});

router.patch("/groups/:groupId", requirePermission("groups.write"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
  const [current] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!current) { res.status(404).json({ error: "Group not found" }); return; }

  const body = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
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

  const [updated] = await db.update(groupsTable).set(patch).where(eq(groupsTable.id, groupId)).returning();
  await audit(groupId, "group.update", req.authedUser, patch, { ...current });
  res.json(shapeGroup(updated));
});

router.get("/groups/:groupId", requirePermission("groups.read"), async (req, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
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

  const [parent] = group.parentGroupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, group.parentGroupId))
    : [null];
  const children = await db.select().from(groupsTable).where(eq(groupsTable.parentGroupId, groupId));

  const transfers = await db.select().from(groupTransfersTable)
    .where(or(eq(groupTransfersTable.toGroupId, groupId), eq(groupTransfersTable.fromGroupId, groupId)))
    .orderBy(desc(groupTransfersTable.transferredAt))
    .limit(50);

  const kpis = await computeKpis([groupId]);
  res.json({
    ...shapeGroup(group, kpis[groupId]),
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
    const sameGroup = farmers.filter(f => f.groupId === toGroupId);
    if (sameGroup.length === farmers.length) {
      return { error: "All selected farmers are already in the target group" as const };
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
  if ("error" in result) { res.status(400).json({ error: result.error }); return; }
  res.json({ movedCount: result.moved.length, farmerIds: result.moved, toGroupId });
});

// ------------- ARCHIVE (deactivate + redistribute) -------------

router.post("/groups/:groupId/archive", requirePermission("groups.archive"), async (req: AuthedRequest, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
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
    const [target] = await db.select().from(groupsTable).where(eq(groupsTable.id, redistributeTo));
    if (!target || target.status !== "active") { res.status(400).json({ error: "Redistribute target not found or archived" }); return; }
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

router.get("/groups/:groupId/report", requirePermission("groups.read"), async (req, res): Promise<void> => {
  const groupId = req.params.groupId as string;
  if (!UUID_RE.test(groupId)) { res.status(400).json({ error: "Invalid group id" }); return; }
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
  lines.push(`Group Report,${esc(group.name)}`);
  lines.push(`Generated,${new Date().toISOString()}`);
  lines.push(`District,${esc(group.district ?? "")}`);
  lines.push(`Sub-county,${esc(group.subCounty ?? "")}`);
  lines.push(`Parish,${esc(group.parish ?? "")}`);
  lines.push(`Village,${esc(group.village ?? "")}`);
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
