// Normalized status across both providers. The DB stores these as:
//   pending  -> payments.status = "pending_external"
//   success  -> payments.status = "paid"
//   failed   -> payments.status = "failed" (+ failureReason)
export type NormalizedStatus = "pending" | "success" | "failed";

export interface DisbursementStatus {
  status: NormalizedStatus;
  failureReason?: string;
}

// Result of kicking off a disbursement. providerTxnId is the key we persist and
// later use to query authoritative status / reconcile callbacks.
export interface DisbursementResult {
  providerTxnId: string;
  status: NormalizedStatus;
}
