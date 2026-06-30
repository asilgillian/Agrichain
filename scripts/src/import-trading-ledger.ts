/**
 * CLI wrapper around the idempotent ledger importer.
 *
 * The import logic + source data now live in the shared @workspace/ledger-import
 * lib so both this script and the guarded api-server seed endpoint use one code
 * path. This wrapper just runs it and prints a human-readable reconciliation.
 *
 * Run with:  pnpm --filter @workspace/scripts run import-ledger
 */
import { runLedgerImport } from "@workspace/ledger-import";

async function main(): Promise<void> {
  const result = await runLedgerImport();

  console.log("\n=== Reconciliation (recorded vs ledger) ===");

  console.log("\nPurchases by batch:");
  for (const line of result.purchasesByBatch) {
    console.log(
      `  ${line.key}: recorded ${line.recorded.toLocaleString()}  ledger ${line.ledger.toLocaleString()}  ${line.ok ? "OK" : "MISMATCH"}`,
    );
  }

  console.log("\nRevenue by batch:");
  for (const line of result.revenueByBatch) {
    console.log(
      `  ${line.key}: recorded ${line.recorded.toLocaleString()}  ledger ${line.ledger.toLocaleString()}  ${line.ok ? "OK" : "MISMATCH"}`,
    );
  }

  if (result.overAllocatedLots.length > 0) {
    console.log(`\nLot mass-balance: ${result.overAllocatedLots.length} output lot(s) over-allocated. ✗`);
    for (const l of result.overAllocatedLots) console.log(`  ${l.lotTag}: allocated ${l.allocated} > weight ${l.weight}`);
  } else {
    console.log("\nLot mass-balance: no output lot is over-allocated. ✓");
  }

  const { suppliers, deliveries, batches, salesLines } = result.counts;
  console.log(`\nSuppliers: ${suppliers}  Deliveries: ${deliveries}  Batches: ${batches}  Sales lines: ${salesLines}`);
  console.log(result.allOk ? "\nAll batch totals reconcile. ✓" : "\nSome totals did not reconcile — review above. ✗");
  if (!result.allOk) process.exitCode = 1;
}

main()
  .then(() => {
    console.log("\nImport complete.");
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
