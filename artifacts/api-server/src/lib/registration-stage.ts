import { and, desc, eq, isNull } from "drizzle-orm";
import {
  db,
  registrationTemplatesTable,
  registrationTemplateFieldsTable,
} from "@workspace/db";
import { KNOWN_CORE_FIELD_KEYS } from "./known-registration-fields.js";

export type RegistrationStage = "pre_registered" | "partially_registered" | "fully_registered";

export type ResolvedTemplateField = {
  fieldKey: string;
  label: string;
  fieldType: string;
  required: boolean;
  source: "core_farmer" | "core_livelihood" | "custom";
  options: { value: string; label: string }[] | null;
  sortOrder: number;
};

// Look up the active registration template for the given country, falling back to
// the global (country_code IS NULL) template. Returns null if neither exists, in
// which case callers should preserve legacy behaviour (the hardcoded
// "nationalId required" rule and always-fully_registered on POST /api/farmers).
export async function getActiveTemplate(countryCode?: string | null): Promise<{
  templateId: string;
  fields: ResolvedTemplateField[];
} | null> {
  // Try country-specific first.
  if (countryCode) {
    const [tpl] = await db
      .select({ id: registrationTemplatesTable.id })
      .from(registrationTemplatesTable)
      .where(
        and(
          eq(registrationTemplatesTable.isActive, true),
          eq(registrationTemplatesTable.countryCode, countryCode),
        ),
      )
      .orderBy(desc(registrationTemplatesTable.updatedAt))
      .limit(1);
    if (tpl) return { templateId: tpl.id, fields: await loadFields(tpl.id) };
  }
  // Fall back to global.
  const [global] = await db
    .select({ id: registrationTemplatesTable.id })
    .from(registrationTemplatesTable)
    .where(
      and(
        eq(registrationTemplatesTable.isActive, true),
        isNull(registrationTemplatesTable.countryCode),
      ),
    )
    .orderBy(desc(registrationTemplatesTable.updatedAt))
    .limit(1);
  if (!global) return null;
  return { templateId: global.id, fields: await loadFields(global.id) };
}

async function loadFields(templateId: string): Promise<ResolvedTemplateField[]> {
  const rows = await db
    .select()
    .from(registrationTemplateFieldsTable)
    .where(
      and(
        eq(registrationTemplateFieldsTable.templateId, templateId),
        eq(registrationTemplateFieldsTable.isActive, true),
      ),
    )
    .orderBy(registrationTemplateFieldsTable.sortOrder);
  return rows.map((r) => ({
    fieldKey: r.fieldKey,
    label: r.label,
    fieldType: r.fieldType,
    required: r.required,
    source: r.source as ResolvedTemplateField["source"],
    options: (r.options as ResolvedTemplateField["options"]) ?? null,
    sortOrder: r.sortOrder,
  }));
}

// Decide whether a given field is "filled" on the supplied farmer object.
// `customValues` covers custom fields stored in farmer_custom_field_values.
// `cropsCount` is passed separately because crops live in their own table and
// the farmer object has no direct array column for them.
function isFieldFilled(
  fieldKey: string,
  source: ResolvedTemplateField["source"],
  fieldType: string,
  farmer: Record<string, unknown>,
  customValues: Record<string, string | null>,
  cropsCount: number,
): boolean {
  // Special composite — crops live in farmer_crops.
  if (source !== "custom" && fieldKey === "crops") return cropsCount > 0;

  const raw = source === "custom" ? customValues[fieldKey] : farmer[fieldKey];

  if (raw === undefined || raw === null) return false;
  switch (fieldType) {
    case "text":
    case "date":
    case "choice":
      return typeof raw === "string" ? raw.trim().length > 0 : String(raw).trim().length > 0;
    case "number":
      // 0 is a valid filled-in answer (e.g. "0 months of food shortage").
      if (typeof raw === "number") return Number.isFinite(raw);
      if (typeof raw === "string") return raw.trim().length > 0 && Number.isFinite(Number(raw));
      return false;
    case "multichoice":
      // Postgres text[] arrives as JS array; custom multi-values are a JSON string.
      if (Array.isArray(raw)) return raw.length > 0;
      if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) && parsed.length > 0;
        } catch {
          return raw.trim().length > 0;
        }
      }
      return false;
    case "yesno":
      // Boolean true OR false both count as "answered". Mobile sends custom
      // yes/no values as the strings "yes"/"no" (matching the UI labels), so
      // accept those plus the canonical "true"/"false" forms. Unanswered = null.
      if (typeof raw === "boolean") return true;
      if (typeof raw === "string") {
        const v = raw.trim().toLowerCase();
        return v === "true" || v === "false" || v === "yes" || v === "no";
      }
      return false;
    default:
      // Unknown type — treat any truthy value as filled.
      return Boolean(raw);
  }
}

// Compute the stage the farmer should be in given (a) the active template, (b)
// the merged farmer object (existing row + any patch about to be applied), and
// (c) custom field values. Returns "fully_registered" if every required field
// is filled, else "partially_registered".
//
// When no template exists OR the template has no required fields, returns null
// to signal "let the caller decide" (the caller falls back to the legacy
// hardcoded behaviour). This keeps back-compat until an admin actually publishes
// a template.
export function computeStageFromTemplate(
  fields: ResolvedTemplateField[],
  farmer: Record<string, unknown>,
  customValues: Record<string, string | null>,
  cropsCount: number,
): RegistrationStage | null {
  const required = fields.filter((f) => f.required);
  if (required.length === 0) return null;
  for (const f of required) {
    if (!isFieldFilled(f.fieldKey, f.source, f.fieldType, farmer, customValues, cropsCount)) {
      return "partially_registered";
    }
  }
  return "fully_registered";
}

// Return the list of required field keys that are NOT filled. Used by both the
// stage computation and by the admin UI / mobile form to surface "what's
// missing" without rejecting the submit.
export function listMissingRequiredFields(
  fields: ResolvedTemplateField[],
  farmer: Record<string, unknown>,
  customValues: Record<string, string | null>,
  cropsCount: number,
): string[] {
  return fields
    .filter((f) => f.required)
    .filter((f) => !isFieldFilled(f.fieldKey, f.source, f.fieldType, farmer, customValues, cropsCount))
    .map((f) => f.fieldKey);
}

// Convenience: load active template + compute stage in one call. Returns the
// computed stage OR null if no template (caller falls back to legacy logic).
export async function resolveStage(opts: {
  countryCode?: string | null;
  farmer: Record<string, unknown>;
  customValues?: Record<string, string | null>;
  cropsCount?: number;
}): Promise<RegistrationStage | null> {
  const tpl = await getActiveTemplate(opts.countryCode ?? null);
  if (!tpl) return null;
  return computeStageFromTemplate(
    tpl.fields,
    opts.farmer,
    opts.customValues ?? {},
    opts.cropsCount ?? 0,
  );
}

// Re-export for routes that need to validate custom field keys against the
// known core list.
export { KNOWN_CORE_FIELD_KEYS };
