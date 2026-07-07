import { Router } from "express";
import { db } from "@workspace/db";
import { buyersTable, salesContractsTable, contractAllocationsTable, dispatchesTable, invoicesTable } from "@workspace/db";
import { lotsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { drawDownCommodityStock, InsufficientStockError, UnknownCommodityTypeError } from "../lib/commodity-stock";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

const router = Router();

// Next sequential invoice number. Must be called inside a transaction: the advisory lock
// serializes concurrent generations, and the max-suffix scan (rather than count(*)) keeps
// numbers unique even after deletions.
async function nextInvoiceNumber(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('invoice_number_seq'))`);
  const prefix = `INV${new Date().getFullYear()}`;
  const pattern = `^${prefix}([0-9]+)$`;
  const [row] = await tx
    .select({ max: sql<number>`COALESCE(MAX((SUBSTRING(${invoicesTable.invoiceNumber} FROM ${pattern}))::int), 0)` })
    .from(invoicesTable);
  return `${prefix}${String((row?.max ?? 0) + 1).padStart(4, "0")}`;
}

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

  // Billing status: attach the latest non-cancelled invoice (if any) to each dispatch row.
  const dispatchIds = dispatches.map(d => d.id);
  let invoiceByDispatch: Record<string, { id: string; invoiceNumber: string; status: string; totalAmount: string | null; currency: string }> = {};
  if (dispatchIds.length > 0) {
    const linkedInvoices = await db
      .select({ id: invoicesTable.id, dispatchId: invoicesTable.dispatchId, invoiceNumber: invoicesTable.invoiceNumber, status: invoicesTable.status, totalAmount: invoicesTable.totalAmount, currency: invoicesTable.currency, createdAt: invoicesTable.createdAt })
      .from(invoicesTable)
      .where(and(
        sql`${invoicesTable.dispatchId} = ANY(ARRAY[${sql.join(dispatchIds.map(id => sql`${id}::uuid`), sql`, `)}])`,
        sql`${invoicesTable.status} <> 'CANCELLED'`,
      ))
      .orderBy(desc(invoicesTable.createdAt));
    for (const inv of linkedInvoices) {
      if (inv.dispatchId && !invoiceByDispatch[inv.dispatchId]) {
        invoiceByDispatch[inv.dispatchId] = { id: inv.id, invoiceNumber: inv.invoiceNumber, status: inv.status, totalAmount: inv.totalAmount, currency: inv.currency };
      }
    }
  }

  const data = dispatches.map(d => ({ ...d, invoice: invoiceByDispatch[d.id] ?? null }));
  res.json({ data, total: countResult[0]?.count ?? 0, page, limit });
});

// Create an invoice directly from a dispatch. Buyer/price/currency are prefilled from the
// dispatch's sales contract when present; the caller may override price, tax, due date, etc.
router.post("/dispatches/:id/invoice", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { contractId: bodyContractId, pricePerKg, taxAmount, currency, dueDate, notes } = req.body ?? {};

  const [dispatch] = await db.select().from(dispatchesTable).where(eq(dispatchesTable.id, id)).limit(1);
  if (!dispatch) { res.status(404).json({ error: "Dispatch not found" }); return; }

  const contractId = isUuid(bodyContractId) ? bodyContractId : dispatch.contractId ?? null;
  let contract = null;
  if (contractId) {
    const rows = await db.select().from(salesContractsTable).where(eq(salesContractsTable.id, contractId)).limit(1);
    contract = rows[0] ?? null;
    if (!contract) { res.status(400).json({ error: "contractId does not reference a known sales contract" }); return; }
  }

  const wt = Number(dispatch.dispatchWeightKg ?? 0);
  if (!Number.isFinite(wt) || wt <= 0) { res.status(400).json({ error: "Dispatch has no weight to invoice" }); return; }

  const price = pricePerKg != null && pricePerKg !== "" ? Number(pricePerKg) : Number(contract?.agreedPricePerKg ?? 0);
  if (!Number.isFinite(price) || price <= 0) { res.status(400).json({ error: "pricePerKg is required (no contract price to prefill from)" }); return; }
  const tax = Number(taxAmount ?? 0);
  if (!Number.isFinite(tax) || tax < 0) { res.status(400).json({ error: "taxAmount must be a non-negative number" }); return; }

  const subtotal = wt * price;
  const total = subtotal + tax;

  const invoice = await db.transaction(async (tx) => {
    // Guard against double-billing: lock the dispatch row, then re-check for a live invoice.
    await tx.execute(sql`SELECT id FROM dispatches WHERE id = ${id}::uuid FOR UPDATE`);
    const existing = await tx.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.dispatchId, id), sql`${invoicesTable.status} <> 'CANCELLED'`))
      .limit(1);
    const alreadyBilled = existing[0];
    if (alreadyBilled) return { kind: "alreadyBilled", alreadyBilled } as const;

    const invoiceNumber = await nextInvoiceNumber(tx);
    const [created] = await tx.insert(invoicesTable).values({
      invoiceNumber,
      contractId: contractId ?? undefined,
      dispatchId: id,
      dispatchWeightKg: String(wt),
      pricePerKg: String(price),
      subtotal: String(subtotal),
      taxAmount: String(tax),
      totalAmount: String(total),
      currency: currency ?? contract?.currency ?? "USD",
      dueDate: dueDate || undefined,
      notes: notes || undefined,
      status: "DRAFT",
    }).returning();
    return { kind: "created", created } as const;
  });

  if (invoice.kind === "alreadyBilled") {
    res.status(409).json({ error: `Dispatch is already billed on invoice ${invoice.alreadyBilled.invoiceNumber}` });
    return;
  }
  res.status(201).json(invoice.created);
});

// Attach an existing (not yet linked, not cancelled) invoice to a dispatch.
router.post("/dispatches/:id/attach-invoice", async (req, res): Promise<void> => {
  const { id } = req.params;
  const { invoiceId } = req.body ?? {};
  if (!isUuid(invoiceId)) { res.status(400).json({ error: "invoiceId is required" }); return; }

  const [dispatch] = await db.select({ id: dispatchesTable.id }).from(dispatchesTable).where(eq(dispatchesTable.id, id)).limit(1);
  if (!dispatch) { res.status(404).json({ error: "Dispatch not found" }); return; }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM dispatches WHERE id = ${id}::uuid FOR UPDATE`);
    const existing = await tx.select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.dispatchId, id), sql`${invoicesTable.status} <> 'CANCELLED'`))
      .limit(1);
    if (existing[0]) return { error: `Dispatch is already billed on invoice ${existing[0].invoiceNumber}`, code: 409 } as const;

    // Guarded update: only claims the invoice if it is still unattached and not cancelled.
    const [updated] = await tx.update(invoicesTable)
      .set({ dispatchId: id, updatedAt: new Date() })
      .where(and(eq(invoicesTable.id, invoiceId), sql`${invoicesTable.dispatchId} IS NULL`, sql`${invoicesTable.status} <> 'CANCELLED'`))
      .returning();
    if (!updated) return { error: "Invoice not found, already attached to a dispatch, or cancelled", code: 409 } as const;
    return { updated } as const;
  });

  if ("error" in result) { res.status(409).json({ error: result.error }); return; }
  res.json(result.updated);
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
  // ?unattached=true → only invoices not yet linked to a dispatch (and not cancelled),
  // used by the attach-invoice picker on the dispatches tab.
  const unattached = req.query.unattached === "true";
  const whereClause = unattached
    ? and(sql`${invoicesTable.dispatchId} IS NULL`, sql`${invoicesTable.status} <> 'CANCELLED'`)
    : undefined;
  const [invoices, countResult] = await Promise.all([
    db.select().from(invoicesTable).where(whereClause).orderBy(desc(invoicesTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(invoicesTable).where(whereClause),
  ]);
  res.json({ data: invoices, total: countResult[0]?.count ?? 0, page, limit });
});

router.post("/invoices", async (req, res): Promise<void> => {
  const { contractId, dispatchId, dispatchWeightKg, pricePerKg, taxAmount, currency, dueDate, notes } = req.body;
  if (!contractId) { res.status(400).json({ error: "contractId is required" }); return; }
  const wt = Number(dispatchWeightKg ?? 0);
  const price = Number(pricePerKg ?? 0);
  const subtotal = wt * price;
  const tax = Number(taxAmount ?? 0);
  const total = subtotal + tax;
  const invoice = await db.transaction(async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx);
    const [created] = await tx.insert(invoicesTable).values({
      invoiceNumber, contractId, dispatchId, dispatchWeightKg: wt ? String(wt) : undefined,
      pricePerKg: price ? String(price) : undefined, subtotal: String(subtotal),
      taxAmount: String(tax), totalAmount: String(total), currency: currency ?? "USD",
      dueDate, notes, status: "DRAFT",
    }).returning();
    return created;
  });
  res.status(201).json(invoice);
});

export default router;
