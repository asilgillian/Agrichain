import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, visitsTable, farmersTable } from "@workspace/db";
import { ScheduleVisitBody, ListVisitsQueryParams } from "@workspace/api-zod";
import { toDbDate } from "../lib/dates";

const router: IRouter = Router();

router.get("/visits", async (req, res): Promise<void> => {
  const parsed = ListVisitsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, status } = parsed.data;
  const conditions: any[] = [];
  if (agentId) conditions.push(eq(visitsTable.agentId, agentId));
  if (status) conditions.push(eq(visitsTable.status, status));

  const visits = conditions.length > 0
    ? await db.select().from(visitsTable).where(and(...conditions)).orderBy(visitsTable.scheduledDate)
    : await db.select().from(visitsTable).orderBy(visitsTable.scheduledDate);

  const enriched = await Promise.all(visits.map(async (v) => {
    const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, v.farmerId));
    return {
      ...v,
      farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
      agentName: "Field Agent",
    };
  }));
  res.json(enriched);
});

router.post("/visits", async (req, res): Promise<void> => {
  const parsed = ScheduleVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [visit] = await db.insert(visitsTable).values({
    ...parsed.data,
    scheduledDate: toDbDate(parsed.data.scheduledDate),
  }).returning();
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, visit.farmerId));
  res.status(201).json({
    ...visit,
    farmerName: farmer ? `${farmer.firstName} ${farmer.lastName}` : "Unknown",
    agentName: "Field Agent",
  });
});

router.post("/visits/:visitId/complete", async (req, res): Promise<void> => {
  const { visitId } = req.params;
  const [visit] = await db.update(visitsTable)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(visitsTable.id, visitId as string))
    .returning();
  if (!visit) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  res.json({ ...visit, farmerName: "Unknown", agentName: "Field Agent" });
});

export default router;
