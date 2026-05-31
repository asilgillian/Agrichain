import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, activityFundsTable, usersTable } from "@workspace/db";
import { CreateActivityFundRequestBody, ApproveActivityFundRequestBody, ListActivityFundsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/activity-funds", async (req, res): Promise<void> => {
  const parsed = ListActivityFundsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { agentId, status } = parsed.data;
  const conditions: any[] = [];
  if (agentId) conditions.push(eq(activityFundsTable.agentId, agentId));
  if (status) conditions.push(eq(activityFundsTable.status, status));

  const funds = conditions.length > 0
    ? await db.select().from(activityFundsTable).where(and(...conditions)).orderBy(desc(activityFundsTable.createdAt))
    : await db.select().from(activityFundsTable).orderBy(desc(activityFundsTable.createdAt));

  const enriched = await Promise.all(funds.map(async (f) => {
    const [agent] = await db.select().from(usersTable).where(eq(usersTable.id, f.agentId));
    return {
      ...f,
      agentName: agent ? `${agent.firstName} ${agent.lastName}` : "Field Agent",
      estimatedAmount: parseFloat(f.estimatedAmount ?? "0"),
      approvedAmount: f.approvedAmount ? parseFloat(f.approvedAmount) : null,
      actualAmount: f.actualAmount ? parseFloat(f.actualAmount) : null,
    };
  }));
  res.json(enriched);
});

router.post("/activity-funds", async (req, res): Promise<void> => {
  const parsed = CreateActivityFundRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const agentId = req.body.agentId ?? "00000000-0000-0000-0000-000000000001";
  const [fund] = await db.insert(activityFundsTable).values({
    ...parsed.data,
    agentId,
    estimatedAmount: parsed.data.estimatedAmount.toString(),
    lineItems: parsed.data.lineItems ?? [],
  }).returning();
  res.status(201).json({ ...fund, agentName: "Field Agent", estimatedAmount: parsed.data.estimatedAmount, approvedAmount: null, actualAmount: null });
});

router.post("/activity-funds/:requestId/approve", async (req, res): Promise<void> => {
  const { requestId } = req.params;
  const parsed = ApproveActivityFundRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const newStatus = parsed.data.decision === "approved" ? "approved" : "rejected";
  const [fund] = await db.update(activityFundsTable).set({
    status: newStatus,
    approverComment: parsed.data.comment,
    updatedAt: new Date(),
  }).where(eq(activityFundsTable.id, requestId as string)).returning();
  if (!fund) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json({ ...fund, agentName: "Field Agent", estimatedAmount: parseFloat(fund.estimatedAmount), approvedAmount: null, actualAmount: null });
});

export default router;
