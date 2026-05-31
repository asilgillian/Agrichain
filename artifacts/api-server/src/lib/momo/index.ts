import { randomUUID } from "node:crypto";
import {
  getAirtelConfig,
  getMtnConfig,
  isProviderLive,
  type MomoProvider,
} from "./config";
import { initiateMtnTransfer, queryMtnStatus } from "./mtn";
import { initiateAirtelDisbursement, queryAirtelStatus } from "./airtel";
import type { DisbursementResult, DisbursementStatus } from "./types";

export type { MomoProvider } from "./config";
export { isProviderLive, isMomoEnabled, callbackSecret } from "./config";
export type { DisbursementResult, DisbursementStatus, NormalizedStatus } from "./types";

// Kick off a real disbursement for the given provider. The caller MUST have
// checked isProviderLive(provider) first; this throws if config is missing so a
// silent no-op can never masquerade as a sent payment.
export async function initiateDisbursement(params: {
  provider: MomoProvider;
  amount: number;
  currency: string;
  msisdn: string;
  externalId?: string;
}): Promise<DisbursementResult> {
  const externalId = params.externalId ?? randomUUID();
  if (params.provider === "mtn_momo") {
    const cfg = getMtnConfig();
    if (!cfg) throw new Error("MTN MoMo is not configured");
    return initiateMtnTransfer(cfg, {
      amount: params.amount,
      currency: params.currency,
      msisdn: params.msisdn,
      externalId,
    });
  }
  const cfg = getAirtelConfig();
  if (!cfg) throw new Error("Airtel Money is not configured");
  return initiateAirtelDisbursement(cfg, {
    amount: params.amount,
    msisdn: params.msisdn,
    externalId,
  });
}

// Re-query the provider for the authoritative status of a previously-initiated
// disbursement. Used by both the manual refresh endpoint and the callback
// handler (we never trust callback payloads — we always confirm with the API).
export async function queryDisbursementStatus(params: {
  provider: MomoProvider;
  providerTxnId: string;
}): Promise<DisbursementStatus> {
  if (params.provider === "mtn_momo") {
    const cfg = getMtnConfig();
    if (!cfg) throw new Error("MTN MoMo is not configured");
    return queryMtnStatus(cfg, params.providerTxnId);
  }
  const cfg = getAirtelConfig();
  if (!cfg) throw new Error("Airtel Money is not configured");
  return queryAirtelStatus(cfg, params.providerTxnId);
}
