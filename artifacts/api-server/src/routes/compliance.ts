import { Router, type IRouter } from "express";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  gapAssessmentsTable,
  trainingSessionsTable,
  certificationEnrolmentsTable,
  certificationStreamsTable,
  farmersTable,
  plotsTable,
} from "@workspace/db";
import {
  SubmitGapAssessmentBody,
  CreateTrainingSessionBody,
  ListGapAssessmentsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// EUDR readiness is measured against whichever certification streams are flagged
// requiresGpsPolygon (e.g. an "EUDR" stream) rather than a hardcoded stream name,
// so ops can toggle which streams count from the Certifications admin screen.
//
// NOTE ON SCOPE: this reports real polygon-evidence completeness — it does NOT yet
// implement the other EUDR checks named in the platform spec (EU Forest Observatory
// deforestation-risk lookup, protected-area overlap, or Due Diligence Statement
// field-completeness). Those need an external forest-observatory data source and
// DDS-specific fields that don't exist in the schema yet; "compliant" here means
// "has real polygon geometry on file," which is a necessary but not sufficient
// condition for full EUDR compliance.
router.get("/compliance/eudr", async (req, res): Promise<void> => {
  const eudrStreams = await db
    .select({ id: certificationStreamsTable.id })
    .from(certificationStreamsTable)
    .where(eq(certificationStreamsTable.requiresGpsPolygon, true));
  const eudrStreamIds = eudrStreams.map(s => s.id);

  if (eudrStreamIds.length === 0) {
    res.json({
      compliantFarmers: 0, totalEnrolled: 0, farmersWithPolygon: 0,
      farmersWithoutPolygon: 0, expiringSoon: 0, complianceRate: 0,
      lastUpdated: new Date().toISOString(),
    });
    return;
  }

  const enrolments = await db
    .select({
      farmerId: certificationEnrolmentsTable.farmerId,
      status: certificationEnrolmentsTable.status,
      expiryDate: certificationEnrolmentsTable.expiryDate,
    })
    .from(certificationEnrolmentsTable)
    .where(inArray(certificationEnrolmentsTable.streamId, eudrStreamIds));

  const active = enrolments.filter(e => e.status === "active");
  const activeFarmerIds = [...new Set(active.map(e => e.farmerId))];

  // A farmer only counts as having real polygon evidence if at least one of their
  // plots is an actual GeoJSON Polygon — a single point pin (the mobile "drop a plot
  // pin" flow) is not sufficient evidence for EUDR and must not be counted here.
  const polygonRows = activeFarmerIds.length > 0
    ? await db
        .select({ farmerId: plotsTable.farmerId })
        .from(plotsTable)
        .where(and(
          inArray(plotsTable.farmerId, activeFarmerIds),
          sql`${plotsTable.polygon} ->> 'type' = 'Polygon'`,
        ))
        .groupBy(plotsTable.farmerId)
    : [];
  const farmersWithPolygon = polygonRows.length;
  const farmersWithoutPolygon = activeFarmerIds.length - farmersWithPolygon;

  const now = Date.now();
  const in30Days = now + 30 * 24 * 60 * 60 * 1000;
  const expiringSoon = active.filter(e => {
    if (!e.expiryDate) return false;
    const t = new Date(e.expiryDate).getTime();
    return t >= now && t <= in30Days;
  }).length;

  res.json({
    compliantFarmers: farmersWithPolygon,
    totalEnrolled: enrolments.length,
    farmersWithPolygon,
    farmersWithoutPolygon,
    expiringSoon,
    complianceRate: activeFarmerIds.length > 0 ? farmersWithPolygon / activeFarmerIds.length : 0,
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
