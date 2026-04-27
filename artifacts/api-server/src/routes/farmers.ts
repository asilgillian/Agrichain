import { Router, type IRouter } from "express";
import { eq, ilike, or, and, desc, sql, inArray } from "drizzle-orm";
import { db, farmersTable, groupsTable, plotsTable, certificationEnrolmentsTable, certificationStreamsTable, surveySubmissionsTable, gapAssessmentsTable, auditLogsTable, usersTable, userGroupsTable } from "@workspace/db";
import {
  CreateFarmerBody,
  UpdateFarmerBody,
  ListFarmersQueryParams,
} from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { checkFarmerAccess, isUserScoped, getAssignedGroupIds } from "../lib/assignment-scope";
import { isLeafInsideOrgRegion, isLeafRegion } from "../lib/org-region-scope";

const router: IRouter = Router();

function generateRefNumber(): string {
  return "F" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

async function buildFarmerResponse(farmer: any) {
  const group = farmer.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, farmer.groupId)).limit(1)
    : [];
  return {
    ...farmer,
    groupName: group[0]?.name ?? null,
    areaHectares: 0,
  };
}

router.get("/farmers", async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ListFarmersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, groupId, regionId, status, page = 1, limit = 50 } = parsed.data;
  // registrationStage filter is read directly off req.query because it's not in the
  // (codegen'd) ListFarmersQueryParams schema yet. Whitelist the two valid values
  // so callers can't smuggle arbitrary SQL fragments in.
  const stageRaw = typeof req.query.registrationStage === "string" ? req.query.registrationStage : "";
  const registrationStage = (stageRaw === "pre_registered" || stageRaw === "fully_registered") ? stageRaw : undefined;
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(farmersTable.firstName, `%${search}%`),
        ilike(farmersTable.lastName, `%${search}%`),
        ilike(farmersTable.nationalId, `%${search}%`),
        ilike(farmersTable.referenceNumber, `%${search}%`)
      )
    );
  }
  if (groupId) conditions.push(eq(farmersTable.groupId, groupId));
  if (regionId) conditions.push(eq(farmersTable.regionId, regionId));
  if (status) conditions.push(eq(farmersTable.status, status));
  if (registrationStage) conditions.push(eq(farmersTable.registrationStage, registrationStage));

  // Per-user assignment scoping: if the requester has `groups.assigned_only`
  // (and isn't a wildcard admin), restrict farmers to those whose groupId is
  // in user_groups for this user. With zero assignments → returns empty.
  const perms = req.authedUser?.permissions ?? [];
  const scoped = perms.includes("groups.assigned_only") && !perms.includes("*");
  if (scoped) {
    const assigned = await db
      .select({ groupId: userGroupsTable.groupId })
      .from(userGroupsTable)
      .where(eq(userGroupsTable.userId, req.authedUser!.id));
    const ids = assigned.map(a => a.groupId);
    if (ids.length === 0) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
    conditions.push(inArray(farmersTable.groupId, ids));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [farmers, countResult] = await Promise.all([
    db.select().from(farmersTable).where(whereClause).orderBy(desc(farmersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(farmersTable).where(whereClause),
  ]);

  const groupIds = [...new Set(farmers.map(f => f.groupId).filter(Boolean))];
  const groups = groupIds.length > 0
    ? await db.select().from(groupsTable).where(sql`${groupsTable.id} = ANY(ARRAY[${sql.join(groupIds.map(id => sql`${id}::uuid`), sql`, `)}])`)
    : [];
  const groupMap = Object.fromEntries(groups.map(g => [g.id, g.name]));

  const data = farmers.map(f => ({ ...f, groupName: groupMap[f.groupId] ?? null }));

  res.json({ data, total: countResult[0]?.count ?? 0, page, limit });
});

// ---------- POST /farmers (full registration) ----------
// Requires `farmers.register`. Sets registrationStage='fully_registered'. National ID is
// expected for full registration (the existing CreateFarmerBody schema enforces required
// fields). For lighter capture, agents use POST /farmers/preregister below.
router.post("/farmers", requirePermission("farmers.register"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateFarmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Mandatory group membership (MTANDEO policy): every farmer must belong to an ACTIVE group.
  const rawGroupId: unknown = (parsed.data as any).groupId ?? (req.body as any).groupId;
  if (typeof rawGroupId !== "string" || !rawGroupId) {
    res.status(400).json({ error: "groupId is required — farmers must belong to a group", code: "GROUP_REQUIRED" });
    return;
  }
  const groupId: string = rawGroupId;
  // Per-user assignment scoping: scoped users may only register farmers into groups
  // they are explicitly assigned to.
  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    if (!assigned.has(groupId)) {
      res.status(403).json({ error: "You are not assigned to this group" });
      return;
    }
  }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(400).json({ error: "Group not found", code: "GROUP_NOT_FOUND" }); return; }
  if (group.status === "archived") {
    res.status(400).json({ error: "Cannot register farmer into an archived group", code: "GROUP_ARCHIVED" });
    return;
  }
  const referenceNumber = generateRefNumber();
  const now = new Date();
  const [farmer] = await db.insert(farmersTable).values({
    ...parsed.data,
    referenceNumber,
    registrationStage: "fully_registered",
    fullyRegisteredAt: now,
    preRegisteredAt: now, // For audit symmetry — full registration always passes through "pre" implicitly.
  }).returning();
  const result = await buildFarmerResponse(farmer);
  res.status(201).json(result);
});

// ---------- POST /farmers/preregister (light capture) ----------
// Captures the bare minimum to identify a farmer in the field — name, group, region, and
// optionally phone/village. National ID and other KYC fields can be added later via
// /farmers/:farmerId/complete. Status is set to 'pending' so admin/full registration is
// required before the farmer is treated as active.
router.post("/farmers/preregister", requirePermission("farmers.preregister"), async (req: AuthedRequest, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const regionId = typeof body.regionId === "string" ? body.regionId : "";
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const village = typeof body.village === "string" ? body.village.trim() : "";
  const sex = typeof body.sex === "string" ? body.sex : "";
  const orgRegionId = typeof body.orgRegionId === "string" ? body.orgRegionId.trim() : "";

  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.firstName = "Required";
  if (!lastName) fieldErrors.lastName = "Required";
  if (!groupId) fieldErrors.groupId = "Required";
  if (!regionId) fieldErrors.regionId = "Required";
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({ error: "Missing required fields", fieldErrors });
    return;
  }
  // Org Region binding (mobile 3-dropdown flow). When supplied, enforce that:
  //   1. regionId is a true leaf (village) - prevents passing an ancestor that
  //      would coincidentally pass the "inside org region" check.
  //   2. The picked village's ancestor district is in the org region.
  //   3. The picked group's anchor village ancestor district is in the org region.
  // Forms that don't yet send orgRegionId continue to work for back-compat;
  // the web back-office still uses the cascading region picker without it.
  if (orgRegionId) {
    const [grp] = await db
      .select({ id: groupsTable.id, regionId: groupsTable.regionId })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId));
    if (!grp) { res.status(400).json({ error: "Group not found", code: "GROUP_NOT_FOUND" }); return; }
    const isLeaf = await isLeafRegion(regionId);
    if (!isLeaf) {
      res.status(400).json({ error: "Selected village must be at the deepest admin level", code: "REGION_NOT_LEAF" });
      return;
    }
    const villageOk = await isLeafInsideOrgRegion(regionId, orgRegionId);
    if (!villageOk) {
      res.status(400).json({ error: "Selected village is not inside the chosen region", code: "VILLAGE_OUT_OF_ORG_REGION" });
      return;
    }
    const groupVillageOk = await isLeafInsideOrgRegion(grp.regionId, orgRegionId);
    if (!groupVillageOk) {
      res.status(400).json({ error: "Selected group is not inside the chosen region", code: "GROUP_OUT_OF_ORG_REGION" });
      return;
    }
  }
  // Per-user assignment scoping: field staff with `groups.assigned_only` may only
  // pre-register into groups they are assigned to.
  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    if (!assigned.has(groupId)) {
      res.status(403).json({ error: "You are not assigned to this group" });
      return;
    }
  }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(400).json({ error: "Group not found", code: "GROUP_NOT_FOUND" }); return; }
  if (group.status === "archived") {
    res.status(400).json({ error: "Cannot pre-register into an archived group", code: "GROUP_ARCHIVED" });
    return;
  }
  const referenceNumber = generateRefNumber();
  const now = new Date();
  const [farmer] = await db.insert(farmersTable).values({
    firstName,
    lastName,
    groupId,
    regionId,
    phoneNumber: phoneNumber || null,
    village: village || null,
    sex: sex || null,
    status: "pending",
    registrationStage: "pre_registered",
    preRegisteredAt: now,
    referenceNumber,
  }).returning();
  const result = await buildFarmerResponse(farmer);
  res.status(201).json(result);
});

// ---------- POST /farmers/:farmerId/complete (promote pre→full) ----------
// Promotes a pre_registered farmer to fully_registered. Accepts the missing KYC fields
// (national ID, sex, DOB, household details, etc.) and marks the farmer 'active'.
router.post("/farmers/:farmerId/complete", requirePermission("farmers.register"), async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [existing] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId as string));
  if (!existing) { res.status(404).json({ error: "Farmer not found" }); return; }
  if (existing.registrationStage === "fully_registered") {
    res.status(409).json({ error: "Farmer is already fully registered", code: "ALREADY_FULLY_REGISTERED" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  // National ID is the minimum KYC requirement to qualify as "fully registered".
  // The DB schema doesn't enforce it (legacy farmers may lack it), so we enforce it here.
  const nationalId = typeof body.nationalId === "string" ? body.nationalId.trim() : "";
  if (!nationalId) {
    res.status(400).json({ error: "nationalId is required to complete registration", code: "NATIONAL_ID_REQUIRED" });
    return;
  }
  const patch: Record<string, unknown> = {
    registrationStage: "fully_registered",
    fullyRegisteredAt: new Date(),
    status: "active",
    nationalId,
    updatedAt: new Date(),
  };
  // Selectively accept the rest of the KYC fields. We deliberately don't allow overwriting
  // groupId here — group transfers go through their own endpoint with the correct audit trail.
  if (typeof body.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth)) patch.dateOfBirth = body.dateOfBirth;
  if (typeof body.sex === "string" && body.sex.trim()) patch.sex = body.sex.trim();
  if (typeof body.householdSize === "number") patch.householdSize = body.householdSize;
  if (typeof body.dependants === "number") patch.dependants = body.dependants;
  if (typeof body.headOfHousehold === "string" && body.headOfHousehold.trim()) patch.headOfHousehold = body.headOfHousehold.trim();
  if (typeof body.landTenure === "string" && body.landTenure.trim()) patch.landTenure = body.landTenure.trim();
  if (typeof body.village === "string" && body.village.trim()) patch.village = body.village.trim();
  if (typeof body.phoneNumber === "string" && body.phoneNumber.trim()) patch.phoneNumber = body.phoneNumber.trim();

  const [updated] = await db.update(farmersTable).set(patch).where(eq(farmersTable.id, farmerId as string)).returning();
  const result = await buildFarmerResponse(updated);
  res.json(result);
});

router.get("/farmers/duplicates", async (req: AuthedRequest, res): Promise<void> => {
  // Duplicate review is an admin/data-stewardship task that needs visibility across
  // the whole farmer corpus. Per-group field staff are not allowed to see this list.
  if (isUserScoped(req.authedUser)) {
    res.status(403).json({ error: "Duplicate review is not available for assigned-only users" });
    return;
  }
  const farmers = await db.select().from(farmersTable).limit(100);
  const pairs: any[] = [];
  for (let i = 0; i < farmers.length; i++) {
    for (let j = i + 1; j < farmers.length; j++) {
      const a = farmers[i];
      const b = farmers[j];
      const reasons: string[] = [];
      if (a.nationalId && b.nationalId && a.nationalId === b.nationalId) reasons.push("national_id_match");
      if (a.firstName === b.firstName && a.lastName === b.lastName) reasons.push("name_match");
      if (reasons.length > 0) {
        pairs.push({
          id: `${a.id}-${b.id}`,
          farmer1: { ...a, groupName: null },
          farmer2: { ...b, groupName: null },
          matchScore: reasons.length * 0.5,
          matchReasons: reasons,
          status: "pending",
        });
      }
    }
  }
  res.json(pairs.slice(0, 20));
});

router.post("/farmers/duplicates/:pairId/merge", async (req: AuthedRequest, res): Promise<void> => {
  // Same scope rule as the duplicates list: scoped users can't merge across the corpus.
  if (isUserScoped(req.authedUser)) {
    res.status(403).json({ error: "Duplicate merge is not available for assigned-only users" });
    return;
  }
  const { masterFarmerId } = req.body;
  if (!masterFarmerId) {
    res.status(400).json({ error: "masterFarmerId required" });
    return;
  }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, masterFarmerId));
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const result = await buildFarmerResponse(farmer);
  res.json(result);
});

router.get("/farmers/:farmerId", async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId as string));
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const [plots, enrolments, surveys, gapScores] = await Promise.all([
    db.select().from(plotsTable).where(eq(plotsTable.farmerId, farmerId as string)),
    db.select({
      enrolment: certificationEnrolmentsTable,
      streamName: certificationStreamsTable.name,
    }).from(certificationEnrolmentsTable)
      .leftJoin(certificationStreamsTable, eq(certificationEnrolmentsTable.streamId, certificationStreamsTable.id))
      .where(eq(certificationEnrolmentsTable.farmerId, farmerId as string)),
    db.select().from(surveySubmissionsTable).where(eq(surveySubmissionsTable.farmerId, farmerId as string)).orderBy(desc(surveySubmissionsTable.submittedAt)).limit(5),
    db.select().from(gapAssessmentsTable).where(eq(gapAssessmentsTable.farmerId, farmerId as string)).orderBy(desc(gapAssessmentsTable.assessedAt)).limit(1),
  ]);
  const group = farmer.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, farmer.groupId)).limit(1)
    : [];
  const result = {
    ...farmer,
    groupName: group[0]?.name ?? null,
    plots: plots.map(p => ({ ...p, areaHectares: parseFloat(p.areaHectares ?? "0") })),
    certifications: enrolments.map(e => ({ ...e.enrolment, streamName: e.streamName ?? "Unknown" })),
    recentSurveys: surveys.map(s => ({ ...s, templateName: "Survey", agentName: "Agent", farmerName: `${farmer.firstName} ${farmer.lastName}` })),
    gapScore: gapScores[0] ? parseFloat(gapScores[0].overallScore ?? "0") : null,
  };
  res.json(result);
});

router.patch("/farmers/:farmerId", async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const parsed = UpdateFarmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Defense in depth: if the patch tries to MOVE the farmer into a different group,
  // the caller must also be assigned to the destination group. Group transfers go
  // through the dedicated transfer endpoint normally, but PATCH technically allows
  // a groupId update too.
  if (isUserScoped(req.authedUser) && typeof (parsed.data as any).groupId === "string") {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    if (!assigned.has((parsed.data as any).groupId)) {
      res.status(403).json({ error: "You are not assigned to the destination group" });
      return;
    }
  }
  const [farmer] = await db.update(farmersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(farmersTable.id, farmerId as string)).returning();
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const result = await buildFarmerResponse(farmer);
  res.json(result);
});

router.get("/farmers/:farmerId/card", async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId as string));
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const enrolments = await db.select({
    enrolment: certificationEnrolmentsTable,
    streamName: certificationStreamsTable.name,
  }).from(certificationEnrolmentsTable)
    .leftJoin(certificationStreamsTable, eq(certificationEnrolmentsTable.streamId, certificationStreamsTable.id))
    .where(eq(certificationEnrolmentsTable.farmerId, farmerId as string));
  const group = farmer.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, farmer.groupId)).limit(1)
    : [];
  res.json({
    farmerId: farmer.id,
    referenceNumber: farmer.referenceNumber,
    fullName: `${farmer.firstName} ${farmer.lastName}`,
    photoUrl: farmer.photoUrl,
    groupName: group[0]?.name ?? "",
    village: farmer.village ?? "",
    qrCodeData: `AGRI:${farmer.referenceNumber}`,
    certifications: enrolments.map(e => ({
      streamName: e.streamName ?? "Unknown",
      status: e.enrolment.status,
      expiryDate: e.enrolment.expiryDate,
    })),
  });
});

export default router;
