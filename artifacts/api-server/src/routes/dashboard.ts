import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, farmersTable, plotsTable, groupsTable, deliveriesTable, paymentsTable, certificationEnrolmentsTable, certificationStreamsTable, auditLogsTable } from "@workspace/db";
import { GetDashboardActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res): Promise<void> => {
  const [farmersCount] = await db.select({ count: sql<number>`count(*)::int` }).from(farmersTable);
  const [activePlots] = await db.select({ count: sql<number>`count(*)::int` }).from(plotsTable).where(eq(plotsTable.status, "active"));
  const [groups] = await db.select({ count: sql<number>`count(*)::int` }).from(groupsTable);
  const [pendingDeliveries] = await db.select({ count: sql<number>`count(*)::int` }).from(deliveriesTable).where(eq(deliveriesTable.status, "pending_weight"));
  const [pendingPayments] = await db.select({ count: sql<number>`count(*)::int` }).from(paymentsTable).where(eq(paymentsTable.status, "pending"));

  const deliveries = await db.select().from(deliveriesTable).where(eq(deliveriesTable.status, "approved"));
  const totalProcuredKg = deliveries.reduce((s, d) => s + parseFloat(d.netWeightKg ?? "0"), 0);

  const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.status, "pending"));
  const totalPaymentsPending = payments.reduce((s, p) => s + parseFloat(p.amountDue ?? "0"), 0);

  const enrolments = await db.select().from(certificationEnrolmentsTable);
  const active = enrolments.filter(e => e.status === "active");
  const complianceRate = enrolments.length > 0 ? active.length / enrolments.length : 0;

  const areaResult = await db.select({ total: sql<string>`sum(area_hectares)` }).from(plotsTable);
  const totalAreaHectares = parseFloat(areaResult[0]?.total ?? "0");

  res.json({
    totalFarmers: farmersCount?.count ?? 0,
    activePlots: activePlots?.count ?? 0,
    totalGroups: groups?.count ?? 0,
    totalAreaHectares,
    pendingDeliveries: pendingDeliveries?.count ?? 0,
    totalProcuredKg,
    totalPaymentsPending,
    complianceRate,
    syncPendingCount: 3,
    currency: "KES",
  });
});

router.get("/dashboard/activity", async (req, res): Promise<void> => {
  const parsed = GetDashboardActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const limit = parsed.data.limit ?? 20;
  const logs = await db.select().from(auditLogsTable).orderBy(desc(auditLogsTable.timestamp)).limit(limit);
  res.json(logs.map(l => ({
    id: l.id,
    entityType: l.entityType,
    entityId: l.entityId,
    action: l.action,
    actorName: l.actorName,
    actorRole: l.actorRole,
    timestamp: l.timestamp,
    summary: `${l.actorName} ${l.action} ${l.entityType}`,
  })));
});

router.get("/dashboard/compliance-overview", async (req, res): Promise<void> => {
  const streams = await db.select().from(certificationStreamsTable);
  const enrolments = await db.select().from(certificationEnrolmentsTable);
  const streamStats = streams.map(s => {
    const streamEnrolments = enrolments.filter(e => e.streamId === s.id);
    const active = streamEnrolments.filter(e => e.status === "active");
    const today = new Date();
    const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringSoon = streamEnrolments.filter(e => {
      if (!e.expiryDate) return false;
      const exp = new Date(e.expiryDate);
      return exp <= in30Days && exp >= today;
    });
    return {
      streamId: s.id,
      streamName: s.name,
      enrolledFarmers: streamEnrolments.length,
      compliantFarmers: active.length,
      complianceRate: streamEnrolments.length > 0 ? active.length / streamEnrolments.length : 0,
      expiringIn30Days: expiringSoon.length,
    };
  });
  res.json({ streams: streamStats });
});

router.get("/dashboard/procurement-stats", async (req, res): Promise<void> => {
  const deliveries = await db.select().from(deliveriesTable);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const weekly = deliveries.filter(d => d.createdAt >= weekAgo);
  const monthly = deliveries.filter(d => d.createdAt >= monthAgo);
  const pending = deliveries.filter(d => ["pending_weight", "pending_qc", "pending_pricing", "pending_approval"].includes(d.status));
  const rejected = deliveries.filter(d => d.status === "rejected");
  const approved = deliveries.filter(d => d.status === "approved" && d.createdAt >= monthAgo);

  res.json({
    weeklyVolumeKg: weekly.reduce((s, d) => s + parseFloat(d.netWeightKg ?? "0"), 0),
    monthlyVolumeKg: monthly.reduce((s, d) => s + parseFloat(d.netWeightKg ?? "0"), 0),
    pendingApprovals: pending.length,
    rejectedDeliveries: rejected.length,
    totalValueThisMonth: approved.reduce((s, d) => s + parseFloat(d.totalValue ?? "0"), 0),
    currency: "KES",
  });
});

export default router;
