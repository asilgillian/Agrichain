/**
 * Idempotent importer for the MTANDEO 5-batch coffee trading ledger.
 *
 * Loads the cleaned ledger (./data/trading-ledger.json) into AgriChain:
 *   - 14 deduplicated suppliers
 *   - 20 coffee purchases as deliveries (approved, with net weight, unit price, value)
 *   - 5 batches grouping the deliveries (B1-B5)
 *   - one warehouse lot per delivery
 *   - graded sales for batches 3-5 and whole-batch sales for batches 1-2
 *
 * Everything is keyed on deterministic natural keys (referenceNumber, deliveryNumber,
 * lotTag, batchTag, contractNumber, invoiceNumber) so re-running updates rather than
 * duplicates. Safe to run multiple times.
 *
 * This module exposes `runLedgerImport()` returning a structured reconciliation
 * result (no console output, no process.exit) so it can be driven both from a CLI
 * script (@workspace/scripts) and from a guarded HTTP endpoint (api-server).
 */
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  suppliersTable,
  deliveriesTable,
  batchesTable,
  lotsTable,
  buyersTable,
  salesContractsTable,
  contractAllocationsTable,
  invoicesTable,
  usersTable,
} from "@workspace/db";
import ledgerData from "./data/trading-ledger.json";

const CROP_TYPE = "dried_robusta";
const CURRENCY = "UGX";
const BUYER_NAME = "Historical Ledger Buyer (TBC)";

type Supplier = {
  ref: string; sellerType: string; firstName: string; lastName: string | null;
  village?: string; status?: string; notes?: string;
};
type Delivery = {
  key: string; batch: string; supplierRef: string; date: string;
  grossKg: number | null; netKg: number; pricePerKg: number; totalValue: number;
  qualityDiscount?: number; note?: string;
};
type BatchRow = { key: string; batchTag: string; harvestDate: string; ledgerPurchaseTotal: number };
type Sale = {
  batch: string; whole?: boolean; gradeCode: string; grade: string | null;
  kg: number; pricePerKg?: number; amount: number;
};
type Ledger = {
  suppliers: Supplier[]; deliveries: Delivery[]; batches: BatchRow[]; sales: Sale[];
  expectedTotals: {
    purchasesByBatch: Record<string, number>;
    revenueByBatch: Record<string, number>;
  };
};

export interface ReconcileLine {
  key: string;
  recorded: number;
  ledger: number;
  ok: boolean;
}

export interface OverAllocatedLot {
  lotTag: string;
  allocated: string;
  weight: string;
}

export interface LedgerImportResult {
  counts: { suppliers: number; deliveries: number; batches: number; salesLines: number };
  purchasesByBatch: ReconcileLine[];
  revenueByBatch: ReconcileLine[];
  overAllocatedLots: OverAllocatedLot[];
  allOk: boolean;
}

function loadLedger(): Ledger {
  return ledgerData as unknown as Ledger;
}

const num = (n: number) => String(n);

export async function runLedgerImport(): Promise<LedgerImportResult> {
  const ledger = loadLedger();

  // Pick a system user to own the historical batches / approvals.
  const [agent] =
    await db.select().from(usersTable).where(eq(usersTable.role, "SystemAdministrator")).limit(1);
  const owner = agent ?? (await db.select().from(usersTable).limit(1))[0];
  if (!owner) throw new Error("No user found to own the imported batches. Seed at least one user first.");
  const ownerId = owner.id;
  const ts = (d: string) => new Date(`${d}T12:00:00.000Z`);

  await db.transaction(async (tx) => {
    // ---- 1. Suppliers ----------------------------------------------------
    const supplierIdByRef = new Map<string, string>();
    for (const s of ledger.suppliers) {
      const [row] = await tx
        .insert(suppliersTable)
        .values({
          referenceNumber: s.ref,
          sellerType: s.sellerType,
          firstName: s.firstName,
          lastName: s.lastName ?? null,
          village: s.village ?? null,
          status: s.status ?? "active",
          notes: s.notes ?? null,
        })
        .onConflictDoUpdate({
          target: suppliersTable.referenceNumber,
          set: {
            sellerType: s.sellerType,
            firstName: s.firstName,
            lastName: s.lastName ?? null,
            village: s.village ?? null,
            status: s.status ?? "active",
            notes: s.notes ?? null,
            updatedAt: new Date(),
          },
        })
        .returning({ id: suppliersTable.id });
      supplierIdByRef.set(s.ref, row!.id);
    }

    // ---- 2. Batches ------------------------------------------------------
    // totalWeightKg = sum of captured (gross||net) weight of member deliveries.
    const batchIdByKey = new Map<string, string>();
    for (const b of ledger.batches) {
      const members = ledger.deliveries.filter((d) => d.batch === b.key);
      const totalWeight = members.reduce((acc, d) => acc + (d.grossKg ?? d.netKg), 0);
      const [row] = await tx
        .insert(batchesTable)
        .values({
          batchTag: b.batchTag,
          agentId: ownerId,
          cropType: CROP_TYPE,
          totalWeightKg: num(totalWeight),
          farmerCount: 0,
          status: "locked",
          harvestDate: b.harvestDate,
          farmerContributions: [],
        })
        .onConflictDoUpdate({
          target: batchesTable.batchTag,
          set: {
            agentId: ownerId,
            cropType: CROP_TYPE,
            totalWeightKg: num(totalWeight),
            status: "locked",
            harvestDate: b.harvestDate,
            updatedAt: new Date(),
          },
        })
        .returning({ id: batchesTable.id });
      batchIdByKey.set(b.key, row!.id);
    }

    // ---- 3. Deliveries + 4. Lots ----------------------------------------
    const firstDeliveryIdByBatch = new Map<string, string>();
    for (const d of ledger.deliveries) {
      const supplierId = supplierIdByRef.get(d.supplierRef);
      if (!supplierId) throw new Error(`Unknown supplierRef ${d.supplierRef} on delivery ${d.key}`);
      const batchId = batchIdByKey.get(d.batch);
      if (!batchId) throw new Error(`Unknown batch ${d.batch} on delivery ${d.key}`);

      const deliveryNumber = `DLV-LGR-${d.key}`;
      const lotTag = `LGR-DLV-${d.key}`;
      const captured = d.grossKg ?? d.netKg;
      const deductions =
        d.qualityDiscount != null
          ? [{ type: "quality_discount", amount: d.qualityDiscount, reason: d.note ?? "Ledger quality discount" }]
          : null;

      const [del] = await tx
        .insert(deliveriesTable)
        .values({
          lotTag,
          deliveryNumber,
          supplierId,
          farmerId: null,
          cropType: CROP_TYPE,
          capturedWeightKg: num(captured),
          capturedById: ownerId,
          capturedAt: ts(d.date),
          batchId,
          grossWeightKg: d.grossKg != null ? num(d.grossKg) : null,
          netWeightKg: num(d.netKg),
          weightApproved: true,
          weightSubmittedById: ownerId,
          weightSubmittedAt: ts(d.date),
          weightApprovedById: ownerId,
          weightApprovedAt: ts(d.date),
          qcApproved: true,
          pricePerKg: num(d.pricePerKg),
          totalValue: num(d.totalValue),
          pricingDeductions: deductions,
          pricingProposedById: ownerId,
          pricingProposedAt: ts(d.date),
          pricingApprovedById: ownerId,
          pricingApprovedAt: ts(d.date),
          status: "approved",
        })
        .onConflictDoUpdate({
          target: deliveriesTable.deliveryNumber,
          set: {
            supplierId,
            farmerId: null,
            cropType: CROP_TYPE,
            capturedWeightKg: num(captured),
            capturedById: ownerId,
            capturedAt: ts(d.date),
            batchId,
            grossWeightKg: d.grossKg != null ? num(d.grossKg) : null,
            netWeightKg: num(d.netKg),
            weightApproved: true,
            qcApproved: true,
            pricePerKg: num(d.pricePerKg),
            totalValue: num(d.totalValue),
            pricingDeductions: deductions,
            status: "approved",
            updatedAt: new Date(),
          },
        })
        .returning({ id: deliveriesTable.id });

      if (!firstDeliveryIdByBatch.has(d.batch)) firstDeliveryIdByBatch.set(d.batch, del!.id);

      await tx
        .insert(lotsTable)
        .values({
          lotTag,
          deliveryId: del!.id,
          weightKg: num(d.netKg),
          status: "received",
          receivedAt: ts(d.date),
        })
        .onConflictDoUpdate({
          target: lotsTable.lotTag,
          set: { deliveryId: del!.id, weightKg: num(d.netKg), status: "received", updatedAt: new Date() },
        });
    }

    // ---- 5. Buyer (single placeholder) ----------------------------------
    const [existingBuyer] = await tx.select().from(buyersTable).where(eq(buyersTable.name, BUYER_NAME)).limit(1);
    let buyerId: string;
    if (existingBuyer) {
      buyerId = existingBuyer.id;
    } else {
      const [b] = await tx
        .insert(buyersTable)
        .values({ name: BUYER_NAME, country: "Uganda", paymentMethod: "cash" })
        .returning({ id: buyersTable.id });
      buyerId = b!.id;
    }

    // ---- 6. Sales: output lots + contracts + invoices + allocations -----
    // Graded sales are of the milled OUTPUT, not the raw delivery lots, so each
    // sale line gets its own output lot (weight == sale kg) and a 1:1 allocation.
    // The output lot must reference a delivery (schema), so it points at the
    // batch's first delivery purely as a provenance anchor.
    for (const sale of ledger.sales) {
      const batchTag = ledger.batches.find((b) => b.key === sale.batch)!.batchTag;
      const contractNumber = `SC-LGR-${sale.batch}-${sale.gradeCode}`;
      const invoiceNumber = `INV-LGR-${sale.batch}-${sale.gradeCode}`;
      const outputLotTag = `LGR-OUT-${sale.batch}-${sale.gradeCode}`;
      const pricePerKg = sale.pricePerKg ?? sale.amount / sale.kg;
      const anchorDeliveryId = firstDeliveryIdByBatch.get(sale.batch)!;

      const [outLot] = await tx
        .insert(lotsTable)
        .values({
          lotTag: outputLotTag,
          deliveryId: anchorDeliveryId,
          weightKg: num(sale.kg),
          status: "sold",
        })
        .onConflictDoUpdate({
          target: lotsTable.lotTag,
          set: { deliveryId: anchorDeliveryId, weightKg: num(sale.kg), status: "sold", updatedAt: new Date() },
        })
        .returning({ id: lotsTable.id });
      const notes = sale.whole
        ? `Whole-batch sale for ledger ${sale.batch} (${batchTag}); no per-grade breakdown in source.`
        : `Graded sale (${sale.grade}) for ledger ${sale.batch} (${batchTag}).`;

      const [contract] = await tx
        .insert(salesContractsTable)
        .values({
          contractNumber,
          buyerId,
          contractType: "LOCAL_SALE",
          commodityType: CROP_TYPE,
          grade: sale.grade,
          targetQuantityKg: num(sale.kg),
          agreedPricePerKg: num(pricePerKg),
          currency: CURRENCY,
          status: "FULLY_FULFILLED",
          approvedById: ownerId,
          approvedAt: new Date(),
          notes,
        })
        .onConflictDoUpdate({
          target: salesContractsTable.contractNumber,
          set: {
            buyerId,
            commodityType: CROP_TYPE,
            grade: sale.grade,
            targetQuantityKg: num(sale.kg),
            agreedPricePerKg: num(pricePerKg),
            currency: CURRENCY,
            status: "FULLY_FULFILLED",
            notes,
            updatedAt: new Date(),
          },
        })
        .returning({ id: salesContractsTable.id });

      await tx
        .insert(invoicesTable)
        .values({
          invoiceNumber,
          contractId: contract!.id,
          dispatchWeightKg: num(sale.kg),
          pricePerKg: num(pricePerKg),
          subtotal: num(sale.amount),
          taxAmount: num(0),
          totalAmount: num(sale.amount),
          paidAmount: num(sale.amount),
          currency: CURRENCY,
          status: "PAID",
        })
        .onConflictDoUpdate({
          target: invoicesTable.invoiceNumber,
          set: {
            contractId: contract!.id,
            dispatchWeightKg: num(sale.kg),
            pricePerKg: num(pricePerKg),
            subtotal: num(sale.amount),
            totalAmount: num(sale.amount),
            paidAmount: num(sale.amount),
            currency: CURRENCY,
            status: "PAID",
            updatedAt: new Date(),
          },
        });

      // 1:1 allocation contract -> its own output lot. Rebuilt deterministically
      // (delete-then-insert) so re-runs never leave stale allocation rows.
      await tx.delete(contractAllocationsTable).where(eq(contractAllocationsTable.contractId, contract!.id));
      await tx.insert(contractAllocationsTable).values({
        contractId: contract!.id,
        lotId: outLot!.id,
        allocatedWeightKg: num(sale.kg),
        allocatedById: ownerId,
      });
    }
  });

  // ---- 7. Reconciliation --------------------------------------------------
  let allOk = true;

  const purchaseRows = await db
    .select({ value: deliveriesTable.totalValue, batchId: deliveriesTable.batchId })
    .from(deliveriesTable)
    .where(inArray(deliveriesTable.deliveryNumber, ledger.deliveries.map((d) => `DLV-LGR-${d.key}`)));
  const batchById = new Map<string, string>();
  for (const b of ledger.batches) {
    const [row] = await db.select({ id: batchesTable.id }).from(batchesTable).where(eq(batchesTable.batchTag, b.batchTag)).limit(1);
    if (row) batchById.set(row.id, b.key);
  }
  const recordedPurchase: Record<string, number> = {};
  for (const r of purchaseRows) {
    const key = r.batchId ? batchById.get(r.batchId) : undefined;
    if (key) recordedPurchase[key] = (recordedPurchase[key] ?? 0) + Number(r.value ?? 0);
  }

  const purchasesByBatch: ReconcileLine[] = [];
  for (const b of ledger.batches) {
    const got = recordedPurchase[b.key] ?? 0;
    const want = ledger.expectedTotals.purchasesByBatch[b.key]!;
    const ok = Math.abs(got - want) < 1;
    if (!ok) allOk = false;
    purchasesByBatch.push({ key: b.key, recorded: got, ledger: want, ok });
  }

  const revenueByBatch: ReconcileLine[] = [];
  for (const b of ledger.batches) {
    const invs = await db
      .select({ total: invoicesTable.totalAmount, contractId: invoicesTable.contractId })
      .from(invoicesTable)
      .innerJoin(salesContractsTable, eq(invoicesTable.contractId, salesContractsTable.id))
      .where(inArray(salesContractsTable.contractNumber, ledger.sales.filter((s) => s.batch === b.key).map((s) => `SC-LGR-${s.batch}-${s.gradeCode}`)));
    const got = invs.reduce((acc, i) => acc + Number(i.total ?? 0), 0);
    const want = ledger.expectedTotals.revenueByBatch[b.key]!;
    const ok = Math.abs(got - want) < 1;
    if (!ok) allOk = false;
    revenueByBatch.push({ key: b.key, recorded: got, ledger: want, ok });
  }

  // Lot mass-balance: each output lot's allocated weight must not exceed its weight.
  const overAllocatedRows = await db
    .select({ lotTag: lotsTable.lotTag, weight: lotsTable.weightKg, allocated: sql<string>`coalesce(sum(${contractAllocationsTable.allocatedWeightKg}), 0)` })
    .from(lotsTable)
    .leftJoin(contractAllocationsTable, eq(contractAllocationsTable.lotId, lotsTable.id))
    .where(inArray(lotsTable.lotTag, ledger.sales.map((s) => `LGR-OUT-${s.batch}-${s.gradeCode}`)))
    .groupBy(lotsTable.lotTag, lotsTable.weightKg)
    .having(sql`coalesce(sum(${contractAllocationsTable.allocatedWeightKg}), 0) > ${lotsTable.weightKg}`);
  const overAllocatedLots: OverAllocatedLot[] = overAllocatedRows.map((l) => ({
    lotTag: l.lotTag,
    allocated: String(l.allocated),
    weight: String(l.weight),
  }));
  if (overAllocatedLots.length > 0) allOk = false;

  return {
    counts: {
      suppliers: ledger.suppliers.length,
      deliveries: ledger.deliveries.length,
      batches: ledger.batches.length,
      salesLines: ledger.sales.length,
    },
    purchasesByBatch,
    revenueByBatch,
    overAllocatedLots,
    allOk,
  };
}
