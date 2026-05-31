import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, gapAssessmentsTable, trainingSessionsTable, certificationEnrolmentsTable, farmersTable } from "@workspace/db";
import {
  SubmitGapAssessmentBody,
  CreateTrainingSessionBody,
  ListGapAssessmentsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/compliance/eudr", async (req, res): Promise<void> => {
  const enrolments = await db.select().from(certificationEnrolmentsTable);
  const eudrEnrolments = enrolments; // In prod, filter by EUDR stream
  const active = eudrEnrolments.filter(e => e.status === "active");
  const total = await db.select({ count: sql<number>`count(*)::int` }).from(farmersTable);
  res.json({
    compliantFarmers: active.length,
    totalEnrolled: eudrEnrolments.length,
    farmersWithPolygon: Math.floor(active.length * 0.8),
    farmersWithoutPolygon: Math.ceil(active.length * 0.2),
    expiringSoon: Math.floor(active.length * 0.05),
    complianceRate: eudrEnrolments.length > 0 ? active.length / eudrEnrolments.length : 0,
    lastUpdated: new Date().toISOString(),
  });
});

router.get("/compliance/gap-assessments", async (req, res): Promise<void> => {
  const parsed = ListGapAssessmentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { farmerId, groupId } = parsed.data;
  const conditions: any[] = [];
  if (farmerId) conditions.push(eq(gapAssessmentsTable.farmerId, farmerId));

  const assessments = conditions.length > 0
    ? await db.select().from(gapAssessmentsTable).where(and(...conditions)).orderBy(desc(gapAssessmentsTable.assessedAt))
    : await db.select().from(gapAssessmentsTable).orderBy(desc(gapAssessmentsTable.assessedAt));

  const enriched = await Promise.all(assessments.map(async (a) => {
    const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, a.farmerId));
    return {
      ...a,
      farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
      agentName: "Field Agent",
      overallScore: parseFloat(a.overallScore ?? "0"),
      maxScore: parseFloat(a.maxScore ?? "0"),
      criteria: (a.criteria as any[]) ?? [],
    };
  }));
  res.json(enriched);
});

router.post("/compliance/gap-assessments", async (req, res): Promise<void> => {
  const parsed = SubmitGapAssessmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const agentId = req.body.agentId ?? "00000000-0000-0000-0000-000000000001";
  const totalScore = parsed.data.criteria.reduce((s, c) => s + c.score, 0);
  const maxScore = parsed.data.criteria.reduce((s, c) => s + c.maxScore, 0);
  const [assessment] = await db.insert(gapAssessmentsTable).values({
    farmerId: parsed.data.farmerId,
    agentId,
    overallScore: totalScore.toString(),
    maxScore: maxScore.toString(),
    criteria: parsed.data.criteria,
  }).returning();
  res.status(201).json({
    ...assessment,
    farmerName: "Unknown",
    agentName: "Field Agent",
    overallScore: totalScore,
    maxScore,
    criteria: parsed.data.criteria,
  });
});

router.get("/compliance/training-sessions", async (req, res): Promise<void> => {
  const sessions = await db.select().from(trainingSessionsTable).orderBy(desc(trainingSessionsTable.scheduledDate));
  res.json(sessions.map(s => ({ ...s, facilitatorName: "Facilitator" })));
});

router.post("/compliance/training-sessions", async (req, res): Promise<void> => {
  const parsed = CreateTrainingSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [session] = await db.insert(trainingSessionsTable).values({
    ...parsed.data,
  }).returning();
  res.status(201).json({ ...session, facilitatorName: "Facilitator" });
});

export default router;
