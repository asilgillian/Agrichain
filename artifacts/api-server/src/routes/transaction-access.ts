import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, transactionAccessRulesTable } from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import {
  ensureDefaultTxnRules,
  VALID_REQUIRED_STAGES,
  VALID_TXN_TYPES,
  type RequiredStage,
  type TxnType,
} from "../lib/transaction-access";

const router: IRouter = Router();

const VALID_TXN_TYPE_SET = new Set<string>(VALID_TXN_TYPES);
const VALID_STAGE_SET = new Set<string>(VALID_REQUIRED_STAGES);

// ---------- ADMIN: list all rules (seeds defaults if missing) ----------
router.get(
  "/admin/transaction-access",
  requirePermission("admin.transaction_access"),
  async (_req, res): Promise<void> => {
    await ensureDefaultTxnRules();
    const rows = await db.select().from(transactionAccessRulesTable);
    // Sort in canonical txn-type order so the admin UI is stable.
    const order = new Map(VALID_TXN_TYPES.map((t, i) => [t, i] as const));
    rows.sort((a, b) => (order.get(a.txnType as TxnType) ?? 99) - (order.get(b.txnType as TxnType) ?? 99));
    res.json(rows);
  },
);

// ---------- ADMIN: update one rule ----------
// Accepts requiredStage and/or isActive. Idempotent — first hit auto-creates
// the missing row so the UI's "save" works even if defaults haven't been
// seeded yet (e.g. PUT before any GET).
router.put(
  "/admin/transaction-access/:txnType",
  requirePermission("admin.transaction_access"),
  async (req: AuthedRequest, res): Promise<void> => {
    const txnType = req.params.txnType as string;
    if (!VALID_TXN_TYPE_SET.has(txnType)) {
      res.status(400).json({ error: `Unknown txnType '${txnType}'`, code: "UNKNOWN_TXN_TYPE" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.requiredStage === "string") {
      if (!VALID_STAGE_SET.has(body.requiredStage)) {
        res.status(400).json({
          error: `requiredStage must be one of ${VALID_REQUIRED_STAGES.join(", ")}`,
          code: "BAD_REQUIRED_STAGE",
        });
        return;
      }
      patch.requiredStage = body.requiredStage as RequiredStage;
    }
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
    if (req.authedUser?.id) patch.updatedById = req.authedUser.id;

    // Upsert by txnType: if the row doesn't exist, insert with defaults + the
    // patch; otherwise update. Two-step rather than onConflictDoUpdate so the
    // unique constraint stays simple (it's already there).
    const [existing] = await db
      .select()
      .from(transactionAccessRulesTable)
      .where(eq(transactionAccessRulesTable.txnType, txnType));
    if (!existing) {
      const [created] = await db
        .insert(transactionAccessRulesTable)
        .values({
          txnType,
          requiredStage: (patch.requiredStage as string) ?? "fully_registered",
          isActive: typeof patch.isActive === "boolean" ? (patch.isActive as boolean) : true,
          updatedById: (patch.updatedById as string) ?? null,
        })
        .returning();
      res.json(created);
      return;
    }
    const [updated] = await db
      .update(transactionAccessRulesTable)
      .set(patch)
      .where(eq(transactionAccessRulesTable.id, existing.id))
      .returning();
    res.json(updated);
  },
);

export default router;
