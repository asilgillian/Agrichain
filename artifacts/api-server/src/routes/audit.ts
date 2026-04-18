import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { ListAuditLogsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/audit", async (req, res): Promise<void> => {
  const parsed = ListAuditLogsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { entityType, entityId, actorId, page = 1, limit = 50 } = parsed.data;
  const offset = (page - 1) * limit;
  const conditions: any[] = [];
  if (entityType) conditions.push(eq(auditLogsTable.entityType, entityType));
  if (entityId) conditions.push(eq(auditLogsTable.entityId, entityId));
  if (actorId) conditions.push(eq(auditLogsTable.actorId, actorId));

  const [logs, countResult] = await Promise.all([
    conditions.length > 0
      ? db.select().from(auditLogsTable).where(and(...conditions)).orderBy(desc(auditLogsTable.timestamp)).limit(limit).offset(offset)
      : db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.timestamp)).limit(limit).offset(offset),
    conditions.length > 0
      ? db.select({ count: sql<number>`count(*)::int` }).from(auditLogsTable).where(and(...conditions))
      : db.select({ count: sql<number>`count(*)::int` }).from(auditLogsTable),
  ]);

  res.json({ data: logs, total: countResult[0]?.count ?? 0, page, limit });
});

export default router;
