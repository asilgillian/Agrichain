import { randomUUID } from "node:crypto";
import type { MtnConfig } from "./config";
import type { DisbursementResult, DisbursementStatus } from "./types";

// === MTN MoMo Disbursements API client ===
// Flow: OAuth (Basic apiUser:apiKey + subscription key) -> POST transfer
// (returns 202, the X-Reference-Id IS the resource id) -> GET transfer/{ref}
// for authoritative status. See https://momodeveloper.mtn.com/.

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getToken(cfg: MtnConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }
  const basic = Buffer.from(`${cfg.apiUser}:${cfg.apiKey}`).toString("base64");
  const res = await fetch(`${cfg.baseUrl}/disbursement/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MTN token request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  cachedToken = { token: json.access_token, expiresAt: now + ttlMs };
  return json.access_token;
}

// Initiate a transfer. Returns the provider transaction reference (our generated
// X-Reference-Id, which is also the status lookup key). MTN is async: a 202 means
// "accepted", not "settled" — status starts PENDING.
export async function initiateMtnTransfer(
  cfg: MtnConfig,
  params: { amount: number; currency: string; msisdn: string; externalId: string; note?: string },
): Promise<DisbursementResult> {
  const token = await getToken(cfg);
  const referenceId = randomUUID();
  const partyId = params.msisdn.replace(/\D/g, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "X-Reference-Id": referenceId,
    "X-Target-Environment": cfg.targetEnvironment,
    "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
    "Content-Type": "application/json",
  };
  if (cfg.callbackUrl) headers["X-Callback-Url"] = cfg.callbackUrl;

  const res = await fetch(`${cfg.baseUrl}/disbursement/v1_0/transfer`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amount: String(params.amount),
      currency: params.currency,
      externalId: params.externalId,
      payee: { partyIdType: "MSISDN", partyId },
      payerMessage: params.note ?? "Mtandeo payout",
      payeeNote: params.note ?? "Mtandeo payout",
    }),
  });
  // 202 Accepted is the success path; MoMo returns an empty body.
  if (res.status !== 202 && !res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MTN transfer failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return { providerTxnId: referenceId, status: "pending" };
}

export async function queryMtnStatus(cfg: MtnConfig, referenceId: string): Promise<DisbursementStatus> {
  const token = await getToken(cfg);
  const res = await fetch(`${cfg.baseUrl}/disbursement/v1_0/transfer/${referenceId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Target-Environment": cfg.targetEnvironment,
      "Ocp-Apim-Subscription-Key": cfg.subscriptionKey,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MTN status query failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { status?: string; reason?: unknown };
  const raw = (json.status ?? "PENDING").toUpperCase();
  if (raw === "SUCCESSFUL") return { status: "success" };
  if (raw === "FAILED") {
    const reason = typeof json.reason === "string" ? json.reason : JSON.stringify(json.reason ?? "FAILED");
    return { status: "failed", failureReason: reason };
  }
  return { status: "pending" };
}
