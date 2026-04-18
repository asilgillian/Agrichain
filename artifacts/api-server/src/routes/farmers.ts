import { Router, type IRouter } from "express";
import { eq, ilike, or, and, desc, sql } from "drizzle-orm";
import { db, farmersTable, groupsTable, plotsTable, certificationEnrolmentsTable, certificationStreamsTable, surveySubmissionsTable, gapAssessmentsTable, auditLogsTable, usersTable } from "@workspace/db";
import {
  CreateFarmerBody,
  UpdateFarmerBody,
  ListFarmersQueryParams,
} from "@workspace/api-zod";

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

router.get("/farmers", async (req, res): Promise<void> => {
  const parsed = ListFarmersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, groupId, regionId, status, page = 1, limit = 50 } = parsed.data;
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

router.post("/farmers", async (req, res): Promise<void> => {
  const parsed = CreateFarmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const referenceNumber = generateRefNumber();
  const [farmer] = await db.insert(farmersTable).values({ ...parsed.data, referenceNumber }).returning();
  const result = await buildFarmerResponse(farmer);
  res.status(201).json(result);
});

router.get("/farmers/duplicates", async (req, res): Promise<void> => {
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

router.post("/farmers/duplicates/:pairId/merge", async (req, res): Promise<void> => {
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

router.get("/farmers/:farmerId", async (req, res): Promise<void> => {
  const { farmerId } = req.params;
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

router.patch("/farmers/:farmerId", async (req, res): Promise<void> => {
  const { farmerId } = req.params;
  const parsed = UpdateFarmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [farmer] = await db.update(farmersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(farmersTable.id, farmerId as string)).returning();
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const result = await buildFarmerResponse(farmer);
  res.json(result);
});

router.get("/farmers/:farmerId/card", async (req, res): Promise<void> => {
  const { farmerId } = req.params;
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
