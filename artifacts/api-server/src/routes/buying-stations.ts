import { Router } from "express";
import { db } from "@workspace/db";
import { buyingStationsTable, agentCashFloatsTable, cashFloatTransactionsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

const router = Router();

router.get("/buying-stations", async (_req, res): Promise<void> => {
  const stations = await db.select().from(buyingStationsTable).orderBy(buyingStationsTable.name);
  res.json(stations);
});

router.post("/buying-stations", async (req, res): Promise<void> => {
  const { name, location, gpsLat, gpsLng, managerUserId } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [station] = await db.insert(buyingStationsTable).values({ name, location, gpsLat, gpsLng, managerUserId }).returning();
  res.status(201).json(station);
});

router.get("/buying-stations/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const station = await db.select().from(buyingStationsTable).where(eq(buyingStationsTable.id, id)).limit(1);
  if (!station[0]) { res.status(404).json({ error: "Buying station not found" }); return; }
  res.json(station[0]);
});

// ─── Agent Cash Floats ─────────────────────────────────────────────────────
router.get("/cash-floats", async (_req, res): Promise<void> => {
  const floats = await db.select().from(agentCashFloatsTable).orderBy(desc(agentCashFloatsTable.updatedAt));
  res.json(floats);
});

router.get("/cash-floats/:agentId", async (req, res): Promise<void> => {
  const { agentId } = req.params;
  const cashFloat = await db.select().from(agentCashFloatsTable).where(eq(agentCashFloatsTable.agentId, agentId)).limit(1);
  if (!cashFloat[0]) { res.status(404).json({ error: "Cash float not found" }); return; }
  const transactions = await db.select().from(cashFloatTransactionsTable).where(eq(cashFloatTransactionsTable.floatId, cashFloat[0].id)).orderBy(desc(cashFloatTransactionsTable.createdAt));
  res.json({ ...cashFloat[0], transactions });
});

router.post("/cash-floats/:agentId/transactions", async (req, res): Promise<void> => {
  const { agentId } = req.params;
  const { type, amount, reference, note } = req.body;
  if (!type || !amount) { res.status(400).json({ error: "type and amount are required" }); return; }

  let cashFloat = (await db.select().from(agentCashFloatsTable).where(eq(agentCashFloatsTable.agentId, agentId)).limit(1))[0];
  if (!cashFloat) {
    [cashFloat] = await db.insert(agentCashFloatsTable).values({ agentId, currentBalance: "0" }).returning();
  }

  const currentBalance = Number(cashFloat.currentBalance ?? 0);
  const amountNum = Number(amount);
  const newBalance = type === "DISBURSE" || type === "DEDUCTION" ? currentBalance - amountNum : currentBalance + amountNum;

  const [txn] = await db.insert(cashFloatTransactionsTable).values({
    floatId: cashFloat.id, type, amount: String(amountNum), balanceAfter: String(newBalance), reference, note,
  }).returning();
  await db.update(agentCashFloatsTable).set({ currentBalance: String(newBalance), updatedAt: new Date() }).where(eq(agentCashFloatsTable.id, cashFloat.id));
  res.status(201).json(txn);
});

export default router;
