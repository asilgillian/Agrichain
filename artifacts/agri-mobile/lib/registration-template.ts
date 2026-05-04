import { useAuth } from "@clerk/expo";
import { useEffect, useState } from "react";

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : "");

// Mirrors the server-side resolved-field shape in api-server/src/lib/registration-stage.ts.
// We re-declare here so mobile doesn't depend on the server package.
export type TemplateField = {
  fieldKey: string;
  label: string;
  fieldType: "text" | "number" | "date" | "choice" | "multichoice" | "yesno" | string;
  required: boolean;
  source: "core_farmer" | "core_livelihood" | "custom" | string;
  options: { value: string; label: string }[] | null;
  sortOrder: number;
};

export type ActiveTemplate = {
  template: { id: string; name: string; countryCode: string | null } | null;
  fields: TemplateField[];
};

const EMPTY: ActiveTemplate = { template: null, fields: [] };

// Module-level memo: the registration template changes rarely (admin action),
// so caching it for the lifetime of the app session is fine. Both register.tsx
// and complete.tsx read it; we don't want each to fetch independently.
let cached: ActiveTemplate | null = null;
let inflight: Promise<ActiveTemplate> | null = null;

export async function fetchActiveTemplate(getToken: () => Promise<string | null>): Promise<ActiveTemplate> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/registration-templates/active?countryCode=UG`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        // Don't surface as an error — clients should fall back to their built-in
        // defaults when no template is published or the endpoint isn't reachable.
        cached = EMPTY;
        return cached;
      }
      const json = await res.json();
      cached = {
        template: json?.template ?? null,
        fields: Array.isArray(json?.fields) ? json.fields : [],
      };
      return cached;
    } catch {
      cached = EMPTY;
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Force a refetch (used after admins publish a new template; not wired to UI yet).
export function clearActiveTemplateCache(): void {
  cached = null;
  inflight = null;
}

export function useActiveTemplate(): { data: ActiveTemplate; loading: boolean } {
  const { getToken } = useAuth();
  const [data, setData] = useState<ActiveTemplate>(cached ?? EMPTY);
  const [loading, setLoading] = useState<boolean>(!cached);
  useEffect(() => {
    let mounted = true;
    fetchActiveTemplate(getToken).then((tpl) => {
      if (mounted) {
        setData(tpl);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, [getToken]);
  return { data, loading };
}

// Helper: is the supplied core field key marked required by the active template?
// When no template is loaded, returns the supplied default (so existing forms
// keep showing the same required indicators they hardcoded).
export function isCoreFieldRequired(
  fields: TemplateField[],
  fieldKey: string,
  defaultRequired: boolean,
): boolean {
  const f = fields.find((x) => x.fieldKey === fieldKey);
  if (!f) return defaultRequired;
  return f.required;
}

// Helper: extract just the custom fields, sorted in the admin-defined order.
export function selectCustomFields(fields: TemplateField[]): TemplateField[] {
  return fields.filter((f) => f.source === "custom").sort((a, b) => a.sortOrder - b.sortOrder);
}
