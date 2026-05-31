// Mobile-money gateway configuration. All credentials come from the environment
// (never hard-coded). When MOMO_ENABLED is off, or a provider is not fully
// configured, the payments route falls back to the legacy `pending_external`
// stub so the rest of the app keeps working without live telco credentials.

export type MomoProvider = "mtn_momo" | "airtel_money";

export interface MtnConfig {
  baseUrl: string;
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  targetEnvironment: string; // "sandbox" | "mtnuganda" | etc.
  callbackUrl?: string;
}

export interface AirtelConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  country: string; // e.g. "UG"
  currency: string; // e.g. "UGX"
  pin?: string; // RSA-encrypted disbursement PIN, when the account requires one
}

// Master switch. Real disbursement is only attempted when this is true AND the
// chosen provider has all its required credentials.
export function isMomoEnabled(): boolean {
  return process.env.MOMO_ENABLED === "true";
}

// Shared secret used to (optionally) authenticate inbound provider callbacks.
// When unset, callbacks are accepted but their payloads are NOT trusted — the
// handler always re-queries the provider for authoritative status.
export function callbackSecret(): string | null {
  const s = process.env.MOMO_CALLBACK_SECRET;
  return s && s.trim() ? s.trim() : null;
}

export function getMtnConfig(): MtnConfig | null {
  const baseUrl = process.env.MOMO_MTN_BASE_URL;
  const subscriptionKey = process.env.MOMO_MTN_SUBSCRIPTION_KEY;
  const apiUser = process.env.MOMO_MTN_API_USER;
  const apiKey = process.env.MOMO_MTN_API_KEY;
  const targetEnvironment = process.env.MOMO_MTN_TARGET_ENV;
  if (!baseUrl || !subscriptionKey || !apiUser || !apiKey || !targetEnvironment) {
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    subscriptionKey,
    apiUser,
    apiKey,
    targetEnvironment,
    callbackUrl: process.env.MOMO_MTN_CALLBACK_URL || undefined,
  };
}

export function getAirtelConfig(): AirtelConfig | null {
  const baseUrl = process.env.MOMO_AIRTEL_BASE_URL;
  const clientId = process.env.MOMO_AIRTEL_CLIENT_ID;
  const clientSecret = process.env.MOMO_AIRTEL_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) {
    return null;
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    clientId,
    clientSecret,
    country: process.env.MOMO_AIRTEL_COUNTRY || "UG",
    currency: process.env.MOMO_AIRTEL_CURRENCY || "UGX",
    pin: process.env.MOMO_AIRTEL_PIN || undefined,
  };
}

// True when the given provider can actually transact (enabled + configured).
export function isProviderLive(provider: MomoProvider): boolean {
  if (!isMomoEnabled()) return false;
  return provider === "mtn_momo" ? getMtnConfig() !== null : getAirtelConfig() !== null;
}
