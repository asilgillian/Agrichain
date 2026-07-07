import { sql, eq } from "drizzle-orm";
import { db, commodityStockMovementsTable, commodityTypesTable } from "@workspace/db";

// Thrown when a requested drawdown exceeds the available net stock of a commodity type.
export class InsufficientStockError extends Error {
  constructor(
    public readonly commodityTypeName: string,
    public readonly availableKg: number,
    public readonly requestedKg: number,
  ) {
    super(
      `Insufficient graded stock of ${commodityTypeName}: ${availableKg.toFixed(2)} kg available, ${requestedKg.toFixed(2)} kg requested`,
    );
    this.name = "InsufficientStockError";
  }
}

export class UnknownCommodityTypeError extends Error {
  constructor() {
    super("Commodity type not found");
    this.name = "UnknownCommodityTypeError";
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Draws `weightKg` of a commodity type down from the commodity stock ledger inside the given
 * transaction. Serializes concurrent drawdowns of the same commodity type with a transaction-scoped
 * advisory lock, verifies the net balance covers the request, and inserts a negative movement row.
 *
 * Throws InsufficientStockError when the request exceeds the available balance (caller maps to 409)
 * and UnknownCommodityTypeError when the commodity type does not exist (caller maps to 400/404).
 */
export async function drawDownCommodityStock(
  tx: Tx,
  params: {
    commodityTypeId: string;
    weightKg: number;
    movementType: "sale_dispatch" | "export_shipment";
    dispatchId?: string | null;
    shipmentId?: string | null;
    notes?: string | null;
    createdById?: string | null;
  },
): Promise<void> {
  const { commodityTypeId, weightKg, movementType, dispatchId, shipmentId, notes, createdById } = params;

  const [ctype] = await tx
    .select({ id: commodityTypesTable.id, name: commodityTypesTable.name })
    .from(commodityTypesTable)
    .where(eq(commodityTypesTable.id, commodityTypeId))
    .limit(1);
  if (!ctype) throw new UnknownCommodityTypeError();

  // Serialize concurrent drawdowns of the same commodity type so two simultaneous sales cannot
  // both pass the balance check and jointly oversell the stock. Lock is released at tx end.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${commodityTypeId}::text))`);

  const [balanceRow] = await tx
    .select({ netStockKg: sql<string>`coalesce(sum(${commodityStockMovementsTable.weightKg}), 0)` })
    .from(commodityStockMovementsTable)
    .where(eq(commodityStockMovementsTable.commodityTypeId, commodityTypeId));
  const available = parseFloat(balanceRow?.netStockKg ?? "0");

  if (weightKg - available > 0.005) {
    throw new InsufficientStockError(ctype.name, available, weightKg);
  }

  await tx.insert(commodityStockMovementsTable).values({
    commodityTypeId,
    weightKg: (-weightKg).toFixed(2),
    movementType,
    dispatchId: dispatchId ?? null,
    shipmentId: shipmentId ?? null,
    notes: notes ?? null,
    createdById: createdById ?? null,
  });
}
