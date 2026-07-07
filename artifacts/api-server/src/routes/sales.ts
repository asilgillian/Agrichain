import { Router } from "express";
import { db } from "@workspace/db";
import { buyersTable, salesContractsTable, contractAllocationsTable, dispatchesTable, invoicesTable } from "@workspace/db";
import { lotsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { drawDownCommodityStock, InsufficientStockError, UnknownCommodityTypeError } from "../lib/commodity-stock";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const router = Router();

// ─── Buyers ───────────────────────────────────────────────────────────────────
router.get("/buyers", async (req, res): Promise<void> => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const [buyers, countResult] = await Promise.all([
    db.select().from(buyersTable).where(eq(buyersTable.isActive, true)).orderBy(buyersTable.name).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(buyersTable).where(eq(buyersTable.isActive, true)),
  ]);
  res.json({ data: buyers, total: countResult[0]?.count ?? 0, page, limit });
});

router.post("/buyers", async (req, res): Promise<void> => {
  const { name, country, contactName, contactEmail, contactPhone, creditTermsDays, paymentMethod, gradeRequirements, originRequirements } = req.body;
  if (!name) { res.status(400).json({ error: "name is required" }); return; }
  const [buyer] = await db.insert(buyersTable).values({ name, country, contactName, contactEmail, contactPhone, creditTermsDays, paymentMethod, gradeRequirements, originRequirements }).returning();
  res.status(201).json(buyer);
});

router.get("/buyers/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const buyer = await db.select().from(buyersTable).where(eq(buyersTable.id, id)).limit(1);
  if (!buyer[0]) { res.status(404).json({ error: "Buyer not found" }); return; }
  const contracts = await db.select().from(salesContractsTable).where(eq(salesContractsTable.buyerId, id)).orderBy(desc(salesContractsTable.createdAt));
  res.json({ ...buyer[0], contracts });
});

// ─── Sales Contracts ───────────────────────────────────────────────────────────
router.get("/sales/contracts", async (req, res): Promise<void> => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const status = req.query.status as string | undefined;

  const conditions = status ? [eq(salesContractsTable.status, status)] : [];
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [contracts, countResult] = await Promise.all([
    db.select().from(salesContractsTable).where(whereClause).orderBy(desc(salesContractsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(salesContractsTable).where(whereClause),
  ]);

  const buyerIds = [...new Set(contracts.map(c => c.buyerId))];
  let buyerMap: Record<string, string> = {};
  if (buyerIds.length > 0) {
    const buyers = await db.select({ id: buyersTable.id, name: buyersTable.name }).from(buyersTable)
      .where(sql`${buyersTable.id} = ANY(ARRAY[${sql.join(buyerIds.map(id => sql`${id}::uuid`), sql`, `)}])`);
    buyerMap = Object.fromEntries(buyers.map(b => [b.id, b.name]));
  }

  const data = contracts.map(c => ({ ...c, buyerName: buyerMap[c.buyerId] ?? null }));
  res.json({ data, total: countResult[0]?.count ?? 0, page, limit });
});

router.get("/sales/contracts/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  const contract = await db.select().from(salesContractsTable).where(eq(salesContractsTable.id, id)).limit(1);
  if (!contract[0]) { res.status(404).json({ error: "Contract not found" }); return; }

  const buyer = await db.select().from(buyersTable).where(eq(buyersTable.id, contract[0].buyerId)).limit(1);
  const allocations = await db.select().from(contractAllocationsTable).where(eq(contractAllocationsTable.contractId, id)).orderBy(desc(contractAllocationsTable.allocatedAt));
  const dispatches = await db.select().from(dispatchesTable).where(eq(dispatchesTable.contractId, id)).orderBy(desc(dispatchesTable.createdAt));
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.contractId, id)).orderBy(desc(invoicesTable.createdAt));

  res.json({ ...contract[0], buyer: buyer[0] ?? null, allocations, dispatches, invoices });
});

router.post("/sales/contracts", async (req, res): Promise<void> => {
  const { buyerId, contractType, commodityType, grade, targetQuantityKg, agreedPricePerKg, currency, deliveryWindowStart, deliveryWindowEnd, incoterms, certificationRequired, notes } = req.body;
  if (!buyerId || !contractType) { res.status(400).json({ error: "buyerId and contractType are required" }); return; }

  const seq = await db.select({ count: sql<number>`count(*)::int` }).from(salesContractsTable);
  const contractNumber = `SC${new Date().getFullYear()}${String((seq[0]?.count ?? 0) + 1).padStart(4, "0")}`;

  const [contract] = await db.insert(salesContractsTable).values({
    contractNumber, buyerId, contractType, commodityType, grade,
    targetQuantityKg: targetQuantityKg ? String(targetQuantityKg) : undefined,
    agreedPricePerKg: agreedPricePerKg ? String(agreedPricePerKg) : undefined,
    currency: currency ?? "USD",
    deliveryWindowStart, deliveryWindowEnd, incoterms, certificationRequired, notes,
    status: "DRAFT",
  }).returning();
  res.status(201).json(contract);
});

router.post("/sales/contracts/:id/approve", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [contract] = await db.update(salesContractsTable).set({ status: "APPROVED", approvedAt: new Date(), approvedById: req.body.userId }).where(eq(salesContractsTable.id, id)).returning();
  if (!contract) { res.status(404).json({ error: "Contract not found" }); return; }
  res.json(contract);
});

// ─── Contract Allocations ────────────────────────────────────────────────────
router.post("/sales/contracts/:id/allocations", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { lotId, allocatedWeightKg } = req.body;
  if (!lotId || !allocatedWeightKg) { res.status(400).json({ error: "lotId and allocatedWeightKg are required" }); return; }
  const [alloc] = await db.insert(contractAllocationsTable).values({ contractId: id, lotId, allocatedWeightKg: String(allocatedWeightKg), allocatedById: req.body.userId }).returning();
  res.status(201).json(alloc);
});

// ─── Dispatches ───────────────────────────────────────────────────────────────
router.get("/dispatches", async (req, res): Promise<void> => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const [dispatches, countResult] = await Promise.all([
    db.select().from(dispatchesTable).orderBy(desc(dispatchesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(dispatchesTable),
  ]);
  res.json({ data: dispatches, total: countResult[0]?.count ?? 0, page, limit });
});

router.post("/dispatches", async (req, res): Promise<void> => {
  const { contractId, commodityTypeId, containerNumber, sealNumber, truckReg, driverName, dispatchWeightKg, notes } = req.body;

  // Selling graded stock directly: when a commodity type is attached, the dispatch weight is drawn
  // down from the commodity stock ledger, so both must be present and valid together.
  const weight = Number(dispatchWeightKg ?? 0);
  if (commodityTypeId != null && commodityTypeId !== "") {
    if (!isUuid(commodityTypeId)) { res.status(400).json({ error: "commodityTypeId must be a valid id" }); return; }
    if (!Number.isFinite(weight) || weight <= 0) { res.status(400).json({ error: "dispatchWeightKg must be a positive number when dispatching graded commodity stock" }); return; }
  }

  try {
    const dispatch = await db.transaction(async (tx) => {
      // Serialize dispatch-number generation: the sequential DSP<year><count> scheme races under
      // concurrent creates (two requests read the same count → duplicate number → 23505). The
      // advisory lock is released when the transaction ends.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('dispatch_number_seq'))`);
      const seq = await tx.select({ count: sql<number>`count(*)::int` }).from(dispatchesTable);
      const dispatchNumber = `DSP${new Date().getFullYear()}${String((seq[0]?.count ?? 0) + 1).padStart(4, "0")}`;

      const [created] = await tx.insert(dispatchesTable).values({
        dispatchNumber, contractId,
        commodityTypeId: isUuid(commodityTypeId) ? commodityTypeId : undefined,
        containerNumber, sealNumber, truckReg, driverName,
        dispatchWeightKg: dispatchWeightKg ? String(dispatchWeightKg) : undefined, notes,
      }).returning();

      if (isUuid(commodityTypeId)) {
        await drawDownCommodityStock(tx, {
          commodityTypeId,
          weightKg: weight,
          movementType: "sale_dispatch",
          dispatchId: created.id,
          notes: `Sold via dispatch ${created.dispatchNumber}`,
        });
      }
      return created;
    });
    res.status(201).json(dispatch);
  } catch (e) {
    if (e instanceof InsufficientStockError) {
      res.status(409).json({ error: e.message, availableKg: e.availableKg, requestedKg: e.requestedKg });
      return;
    }
    if (e instanceof UnknownCommodityTypeError) {
      res.status(400).json({ error: "commodityTypeId does not reference a known commodity type" });
      return;
    }
    throw e;
  }
});

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.get("/invoices", async (req, res): Promise<void> => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const [invoices, countResult] = await Promise.all([
    db.select().from(invoicesTable).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(invoicesTable),
  ]);
  res.json({ data: invoices, total: countResult[0]?.count ?? 0, page, limit });
});

router.post("/invoices", async (req, res): Promise<void> => {
  const { contractId, dispatchId, dispatchWeightKg, pricePerKg, taxAmount, currency, dueDate, notes } = req.body;
  if (!contractId) { res.status(400).json({ error: "contractId is required" }); return; }
  const seq = await db.select({ count: sql<number>`count(*)::int` }).from(invoicesTable);
  const invoiceNumber = `INV${new Date().getFullYear()}${String((seq[0]?.count ?? 0) + 1).padStart(4, "0")}`;
  const wt = Number(dispatchWeightKg ?? 0);
  const price = Number(pricePerKg ?? 0);
  const subtotal = wt * price;
  const tax = Number(taxAmount ?? 0);
  const total = subtotal + tax;
  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber, contractId, dispatchId, dispatchWeightKg: wt ? String(wt) : undefined,
    pricePerKg: price ? String(price) : undefined, subtotal: String(subtotal),
    taxAmount: String(tax), totalAmount: String(total), currency: currency ?? "USD",
    dueDate, notes, status: "DRAFT",
  }).returning();
  res.status(201).json(invoice);
});

export default router;
