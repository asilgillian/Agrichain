import { eq, inArray } from "drizzle-orm";
import type { Response, NextFunction } from "express";
import {
  db,
  transactionAccessRulesTable,
  farmersTable,
  STAGE_RANK,
} from "@workspace/db";
import type { AuthedRequest } from "../middlewares/auth";

export const VALID_TXN_TYPES = ["delivery", "payment", "loan", "certification"] as const;
export type TxnType = (typeof VALID_TXN_TYPES)[number];

export const VALID_REQUIRED_STAGES = ["pre_registered", "partially_registered", "fully_registered"] as const;
export type RequiredStage = (typeof VALID_REQUIRED_STAGES)[number];

// Seed default rules on first read so admins always see the full 4-row matrix
// in the UI without a separate migration step. All four start at the strictest
// gate (`fully_registered`) — matching the legacy behaviour before this module
// existed (where the only stages were pre_registered + fully_registered and
// any non-fully farmer was effectively pending). Admins can then loosen any
// rule individually.
export async function ensureDefaultTxnRules(): Promise<void> {
  const rows = await db.select({ txnType: transactionAccessRulesTable.txnType }).from(transactionAccessRulesTable);
  const existing = new Set(rows.map((r) => r.txnType));
  const missing = VALID_TXN_TYPES.filter((t) => !existing.has(t));
  if (missing.length === 0) return;
  await db.insert(transactionAccessRulesTable).values(
    missing.map((txnType) => ({
      txnType,
      requiredStage: "fully_registered",
      isActive: true,
    })),
  );
}

// Lazy seed flag: ensures default rules exist on the first transaction check
// in a given process, so enforcement works even before any admin opens the
// /admin/transaction-access page. Idempotent across processes (insert is
// guarded by the unique txn_type constraint).
let defaultsSeededInProcess = false;

// Look up the active rule for a txn type. Returns null when no rule exists OR
// the rule is inactive — caller treats that as "no gate" (allow through).
export async function getActiveRule(txnType: TxnType) {
  if (!defaultsSeededInProcess) {
    try {
      await ensureDefaultTxnRules();
    } finally {
      defaultsSeededInProcess = true;
    }
  }
  const [rule] = await db
    .select()
    .from(transactionAccessRulesTable)
    .where(eq(transactionAccessRulesTable.txnType, txnType));
  if (!rule || !rule.isActive) return null;
  return rule;
}

// Core guard: given a farmerId and a txn type, decide whether the transaction
// should be allowed. Returns null on success, or `{status, body}` to short-
// circuit with. Centralising this so middleware and inline checks (for batch
// endpoints with multiple farmer contributions) stay consistent.
export async function checkFarmerStageForTxn(
  farmerId: string,
  txnType: TxnType,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const rule = await getActiveRule(txnType);
  if (!rule) return null;
  const [farmer] = await db
    .select({ id: farmersTable.id, stage: farmersTable.registrationStage })
    .from(farmersTable)
    .where(eq(farmersTable.id, farmerId));
  if (!farmer) {
    return { status: 404, body: { error: "Farmer not found", code: "FARMER_NOT_FOUND" } };
  }
  const farmerRank = STAGE_RANK[farmer.stage] ?? 0;
  const requiredRank = STAGE_RANK[rule.requiredStage] ?? 0;
  if (farmerRank < requiredRank) {
    return {
      status: 403,
      body: {
        error: `This farmer is '${farmer.stage}' but '${rule.requiredStage}' is required for ${txnType}`,
        code: "REGISTRATION_INSUFFICIENT",
        farmerId,
        farmerStage: farmer.stage,
        requiredStage: rule.requiredStage,
        txnType,
      },
    };
  }
  return null;
}

// Same idea but checks an array of farmer IDs in a single query (used by the
// batch creation endpoint, where one batch aggregates many farmers).
export async function checkFarmersStageForTxn(
  farmerIds: string[],
  txnType: TxnType,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  if (farmerIds.length === 0) return null;
  const rule = await getActiveRule(txnType);
  if (!rule) return null;
  const requiredRank = STAGE_RANK[rule.requiredStage] ?? 0;
  const farmers = await db
    .select({ id: farmersTable.id, stage: farmersTable.registrationStage })
    .from(farmersTable)
    .where(inArray(farmersTable.id, farmerIds));
  const byId = new Map(farmers.map((f) => [f.id, f.stage]));
  const offenders: { farmerId: string; stage: string | null }[] = [];
  for (const id of farmerIds) {
    const stage = byId.get(id) ?? null;
    if (!stage) {
      offenders.push({ farmerId: id, stage: null });
      continue;
    }
    if ((STAGE_RANK[stage] ?? 0) < requiredRank) {
      offenders.push({ farmerId: id, stage });
    }
  }
  if (offenders.length > 0) {
    return {
      status: 403,
      body: {
        error: `One or more farmers don't meet the '${rule.requiredStage}' requirement for ${txnType}`,
        code: "REGISTRATION_INSUFFICIENT",
        requiredStage: rule.requiredStage,
        txnType,
        offenders,
      },
    };
  }
  return null;
}

// Express middleware factory. Pulls farmerId from the request via the supplied
// resolver (lets routes choose: req.params.farmerId, req.body.farmerId, etc).
// If the resolver returns null/empty, the middleware skips the check — the
// route handler is responsible for its own "farmer required" validation.
export function requireFarmerStageForTxn(
  txnType: TxnType,
  resolveFarmerId: (req: AuthedRequest) => string | null | undefined,
) {
  return async (req: AuthedRequest, res: Response, next: NextFunction): Promise<void> => {
    const farmerId = resolveFarmerId(req);
    if (!farmerId || typeof farmerId !== "string") {
      next();
      return;
    }
    const denial = await checkFarmerStageForTxn(farmerId, txnType);
    if (denial) {
      res.status(denial.status).json(denial.body);
      return;
    }
    next();
  };
}
