import { randomUUID } from "node:crypto";
import type { AirtelConfig } from "./config";
import type { DisbursementResult, DisbursementStatus } from "./types";

// === Airtel Money Disbursements API client ===
// Flow: OAuth (client_credentials) -> POST /standard/v1/disbursements ->
// GET /standard/v1/disbursements/{id} for status. See https://developers.airtel.africa/.

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(cfg: AirtelConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${cfg.baseUrl}/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Airtel token request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

export async function initiateAirtelDisbursement(
  cfg: AirtelConfig,
  params: { amount: number; msisdn: string; externalId: string },
): Promise<DisbursementResult> {
  const token = await getToken(cfg);
  // Airtel wants the local subscriber number without country code.
  const msisdn = params.msisdn.replace(/\D/g, "").replace(/^256/, "");
  const body: Record<string, unknown> = {
    payee: { msisdn },
    reference: params.externalId,
    transaction: { amount: params.amount, id: params.externalId },
  };
  if (cfg.pin) body.pin = cfg.pin;

  const res = await fetch(`${cfg.baseUrl}/standard/v1/disbursements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Country": cfg.country,
      "X-Currency": cfg.currency,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtel disbursement failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { transaction?: { id?: string; reference_id?: string; airtel_money_id?: string; status?: string } };
    status?: { success?: boolean; message?: string; result_code?: string };
  };
  const txn = json.data?.transaction;
  // Prefer the provider's own id; fall back to our externalId so we can always reconcile.
  const providerTxnId = txn?.id || txn?.airtel_money_id || txn?.reference_id || params.externalId;
  const norm = mapAirtelStatus(txn?.status, json.status?.success);
  if (norm === "failed") {
    throw new Error(`Airtel disbursement rejected: ${json.status?.message ?? txn?.status ?? "unknown"}`);
  }
  return { providerTxnId, status: norm };
}

export async function queryAirtelStatus(cfg: AirtelConfig, transactionId: string): Promise<DisbursementStatus> {
  const token = await getToken(cfg);
  const res = await fetch(`${cfg.baseUrl}/standard/v1/disbursements/${transactionId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Country": cfg.country,
      "X-Currency": cfg.currency,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Airtel status query failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { transaction?: { status?: string; message?: string } };
    status?: { success?: boolean; message?: string };
  };
  const txn = json.data?.transaction;
  const norm = mapAirtelStatus(txn?.status, json.status?.success);
  if (norm === "failed") {
    return { status: "failed", failureReason: txn?.message ?? json.status?.message ?? "FAILED" };
  }
  return { status: norm };
}

// Airtel status codes: TS = success, TF = failed, TIP/TA = in progress/ambiguous.
function mapAirtelStatus(status: string | undefined, success: boolean | undefined): "pending" | "success" | "failed" {
  const s = (status ?? "").toUpperCase();
  if (s === "TS" || s === "SUCCESS" || s === "SUCCESSFUL") return "success";
  if (s === "TF" || s === "FAILED" || s === "FAILURE") return "failed";
  if (success === false) return "failed";
  return "pending";
}

export function newAirtelExternalId(): string {
  return randomUUID();
}
