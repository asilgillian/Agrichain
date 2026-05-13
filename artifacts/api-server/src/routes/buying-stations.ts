import { Router } from "express";
import { db } from "@workspace/db";
import { buyingStationsTable, agentCashFloatsTable, cashFloatTransactionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requirePermission } from "../middlewares/auth";

const router = Router();

// Lookups used by procurement pickers (web + mobile). Anyone with procurement
// read access can list stations.
router.get("/buying-stations", requirePermission("procurement.read"), async (_req, res): Promise<void> => {
  const stations = await db.select().from(buyingStationsTable).orderBy(buyingStationsTable.name);
  res.json(stations);
});

// Station administration is admin-only. Reuses the regions perm so the same
// "Manage admin geography" role implicitly covers stations.
router.post("/buying-stations", requirePermission("admin.regions"), async (req, res): Promise<void> => {
  const { name, location, gpsLat, gpsLng, managerUserId } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [station] = await db.insert(buyingStationsTable).values({ name, location, gpsLat, gpsLng, managerUserId }).returning();
  res.status(201).json(station);
});

router.get("/buying-stations/:id", requirePermission("procurement.read"), async (req, res): Promise<void> => {
  const { id } = req.params;
  const station = await db.select().from(buyingStationsTable).where(eq(buyingStationsTable.id, id)).limit(1);
  if (!station[0]) { res.status(404).json({ error: "Buying station not found" }); return; }
  res.json(station[0]);
});

// ─── Agent Cash Floats ─────────────────────────────────────────────────────
// Visibility gated by payments.read; mutations by payments.write. Top-ups and
// reconciliations are funds-movement events and therefore live behind the
// stronger payments perm (not procurement).
router.get("/cash-floats", requirePermission("payments.read"), async (_req, res): Promise<void> => {
  const floats = await db.select().from(agentCashFloatsTable).orderBy(desc(agentCashFloatsTable.updatedAt));
  res.json(floats);
});

router.get("/cash-floats/:agentId", requirePermission("payments.read"), async (req, res): Promise<void> => {
  const { agentId } = req.params;
  const cashFloat = (await db.select().from(agentCashFloatsTable).where(eq(agentCashFloatsTable.agentId, agentId)).limit(1))[0];
  if (!cashFloat) { res.status(404).json({ error: "Cash float not found" }); return; }
  const transactions = await db.select().from(cashFloatTransactionsTable).where(eq(cashFloatTransactionsTable.floatId, cashFloat.id)).orderBy(desc(cashFloatTransactionsTable.createdAt));
  res.json({ ...cashFloat, transactions });
});

router.post("/cash-floats/:agentId/transactions", requirePermission("payments.write"), async (req, res): Promise<void> => {
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
