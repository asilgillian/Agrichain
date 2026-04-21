export const DEFAULT_CURRENCY = "UGX";
export const DEFAULT_LOCALE = "en-UG";
export const DEFAULT_COUNTRY = "Uganda";
export const DEFAULT_PHONE_CODE = "+256";

export function fmtMoney(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency: DEFAULT_CURRENCY,
    maximumFractionDigits: 0,
  }).format(Number(v));
}

export function fmtMoneyShort(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  return `${DEFAULT_CURRENCY} ${Number(v).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 0 })}`;
}

export const PAYMENT_METHODS = [
  { value: "MTN_MOMO", label: "MTN Mobile Money" },
  { value: "AIRTEL_MONEY", label: "Airtel Money" },
  { value: "BANK_TRANSFER", label: "Bank Transfer" },
  { value: "CASH", label: "Cash" },
  { value: "CROP_DEDUCTION", label: "Crop Deduction" },
] as const;
