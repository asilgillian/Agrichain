// Thin Bearer-auth fetch helper used by the procurement field-capture screens.
// We deliberately don't go through the generated `customFetch` here because
// some of the new endpoints carry fields (msisdn, provider, targetVolumeKg)
// that haven't landed in the OpenAPI spec yet — orval would silently strip them.
//
// Pattern matches what `useMe.ts` already does: pull a fresh Clerk session
// token at call-time so we never cache a stale JWT.
import { useAuth } from "@clerk/expo";
import { useCallback } from "react";

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "");

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export type ApiFetch = <T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown; headers?: Record<string, string> },
) => Promise<T>;

export function useApi(): ApiFetch {
  const { getToken } = useAuth();
  return useCallback(async <T,>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> => {
    const token = await getToken();
    const r = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers ?? {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await r.text();
    let json: any = null;
    if (text) { try { json = JSON.parse(text); } catch { json = text; } }
    if (!r.ok) {
      const msg = (json && typeof json === "object" && json.error) ? json.error : `Request failed (${r.status})`;
      throw new ApiError(r.status, json, msg);
    }
    return json as T;
  }, [getToken]);
}
