/**
 * Convert an API-layer date (Zod `coerce.date()` yields a `Date`) into the
 * `YYYY-MM-DD` string that Drizzle's `date(...)` columns (mode "string") expect.
 *
 * The API contract models calendar dates as date-time `Date` objects, but the
 * database stores them as plain `date`. This is the single conversion point at
 * the insert/update boundary so route handlers can spread parsed bodies safely.
 */
export function toDbDate(d: Date | string): string;
export function toDbDate(d: Date | string | null | undefined): string | null;
export function toDbDate(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d;
  return d.toISOString().slice(0, 10);
}
