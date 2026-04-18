import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, surveyTemplatesTable, surveySubmissionsTable, farmersTable, usersTable } from "@workspace/db";
import {
  CreateSurveyTemplateBody,
  SubmitSurveyBody,
  ReviewSurveySubmissionBody,
  ListSurveySubmissionsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/surveys/templates", async (req, res): Promise<void> => {
  const templates = await db.select().from(surveyTemplatesTable).orderBy(desc(surveyTemplatesTable.createdAt));
  res.json(templates);
});

router.post("/surveys/templates", async (req, res): Promise<void> => {
  const parsed = CreateSurveyTemplateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [template] = await db.insert(surveyTemplatesTable).values(parsed.data).returning();
  res.status(201).json(template);
});

router.get("/surveys/submissions", async (req, res): Promise<void> => {
  const parsed = ListSurveySubmissionsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, groupId, status } = parsed.data;
  const conditions: any[] = [];
  if (agentId) conditions.push(eq(surveySubmissionsTable.agentId, agentId));
  if (status) conditions.push(eq(surveySubmissionsTable.status, status));

  const submissions = conditions.length > 0
    ? await db.select().from(surveySubmissionsTable).where(and(...conditions)).orderBy(desc(surveySubmissionsTable.submittedAt))
    : await db.select().from(surveySubmissionsTable).orderBy(desc(surveySubmissionsTable.submittedAt));

  const enriched = await Promise.all(submissions.map(async (s) => {
    const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, s.farmerId));
    const template = await db.select().from(surveyTemplatesTable).where(eq(surveyTemplatesTable.id, s.templateId)).limit(1);
    return {
      ...s,
      farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
      agentName: "Field Agent",
      templateName: template[0]?.name ?? "Survey",
    };
  }));
  res.json(enriched);
});

router.post("/surveys/submissions", async (req, res): Promise<void> => {
  const parsed = SubmitSurveyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const agentId = req.body.agentId ?? "00000000-0000-0000-0000-000000000001";
  const [submission] = await db.insert(surveySubmissionsTable).values({
    ...parsed.data,
    agentId,
    gpsLat: parsed.data.gpsLat?.toString(),
    gpsLng: parsed.data.gpsLng?.toString(),
  }).returning();
  res.status(201).json({ ...submission, farmerName: "Unknown", agentName: "Agent", templateName: "Survey" });
});

router.post("/surveys/submissions/:submissionId/review", async (req, res): Promise<void> => {
  const { submissionId } = req.params;
  const parsed = ReviewSurveySubmissionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [submission] = await db.update(surveySubmissionsTable)
    .set({ status: parsed.data.decision, reviewComment: parsed.data.comment, reviewedAt: new Date() })
    .where(eq(surveySubmissionsTable.id, submissionId as string))
    .returning();
  if (!submission) {
    res.status(404).json({ error: "Submission not found" });
    return;
  }
  res.json({ ...submission, farmerName: "Unknown", agentName: "Agent", templateName: "Survey" });
});

export default router;
