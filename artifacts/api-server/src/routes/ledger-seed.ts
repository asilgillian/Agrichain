import { Router, type IRouter } from "express";
import { timingSafeEqual } from "node:crypto";
import { runLedgerImport } from "@workspace/ledger-import";

const router: IRouter = Router();

// Constant-time token comparison so the gate doesn't leak the secret length /
// prefix via response timing.
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// One-time, secret-protected seed endpoint used to load the historical trading
// ledger (suppliers, deliveries, batches, lots, sales contracts, invoices) into
// a database that has the schema but no data — primarily the production database
// after publishing, since Replit's publish flow syncs schema only, never rows.
//
// Gate: requires header `x-seed-token` to match the LEDGER_SEED_TOKEN secret.
// It deliberately sits OUTSIDE Clerk auth so it can be triggered without a
// logged-in session. The underlying import is idempotent (natural-key upserts),
// so it is safe to call more than once. Remove this route once prod is seeded.
router.post("/admin/seed-ledger", async (req, res): Promise<void> => {
  const expected = process.env.LEDGER_SEED_TOKEN;
  if (!expected) {
    res.status(503).json({ error: "Seed endpoint disabled — LEDGER_SEED_TOKEN is not configured" });
    return;
  }
  const provided = req.get("x-seed-token") ?? "";
  if (!provided || !tokensMatch(provided, expected)) {
    res.status(401).json({ error: "Invalid or missing seed token" });
    return;
  }

  try {
    const result = await runLedgerImport();
    req.log?.info({ counts: result.counts, allOk: result.allOk }, "ledger seed completed");
    // 200 when everything reconciles, 207 (Multi-Status) when rows imported but
    // some totals did not tie — the body carries the per-batch detail either way.
    res.status(result.allOk ? 200 : 207).json(result);
  } catch (err) {
    req.log?.error({ err }, "ledger seed failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Seed failed" });
  }
});

export default router;
