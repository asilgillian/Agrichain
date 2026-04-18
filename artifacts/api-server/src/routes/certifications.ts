import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, certificationStreamsTable, certificationEnrolmentsTable, farmersTable } from "@workspace/db";
import { CreateEnrolmentBody, ListEnrolmentsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/certifications/streams", async (req, res): Promise<void> => {
  const streams = await db.select().from(certificationStreamsTable);
  res.json(streams);
});

router.get("/certifications/enrolments", async (req, res): Promise<void> => {
  const parsed = ListEnrolmentsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { farmerId, streamId, status } = parsed.data;
  const conditions: any[] = [];
  if (farmerId) conditions.push(eq(certificationEnrolmentsTable.farmerId, farmerId));
  if (streamId) conditions.push(eq(certificationEnrolmentsTable.streamId, streamId));
  if (status) conditions.push(eq(certificationEnrolmentsTable.status, status));

  const enrolments = conditions.length > 0
    ? await db.select({
        enrolment: certificationEnrolmentsTable,
        streamName: certificationStreamsTable.name,
      }).from(certificationEnrolmentsTable)
        .leftJoin(certificationStreamsTable, eq(certificationEnrolmentsTable.streamId, certificationStreamsTable.id))
        .where(and(...conditions))
    : await db.select({
        enrolment: certificationEnrolmentsTable,
        streamName: certificationStreamsTable.name,
      }).from(certificationEnrolmentsTable)
        .leftJoin(certificationStreamsTable, eq(certificationEnrolmentsTable.streamId, certificationStreamsTable.id));

  res.json(enrolments.map(e => ({ ...e.enrolment, streamName: e.streamName ?? "Unknown" })));
});

router.post("/certifications/enrolments", async (req, res): Promise<void> => {
  const parsed = CreateEnrolmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [enrolment] = await db.insert(certificationEnrolmentsTable).values(parsed.data).returning();
  const [stream] = await db.select().from(certificationStreamsTable).where(eq(certificationStreamsTable.id, enrolment.streamId));
  res.status(201).json({ ...enrolment, streamName: stream?.name ?? "Unknown" });
});

export default router;
