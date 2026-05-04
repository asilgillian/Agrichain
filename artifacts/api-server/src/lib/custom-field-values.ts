import { eq } from "drizzle-orm";
import { db, farmerCustomFieldValuesTable } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Minimal structural shape we need from a template field. Both the raw schema
// row type and the resolved type from registration-stage.ts satisfy this, so
// callers can pass either.
type TemplateFieldShape = { fieldKey: string; source: string };

// Parse `customFieldValues` off a request body and validate it against the
// active template's *custom* field definitions. Reasons we validate here:
//   - Reject keys that aren't in the template's custom field list (typos,
//     stale clients, deprecated fields).
//   - Reject collisions with core farmer columns — those are stored on the
//     farmers table, never in this side-table.
//   - Coerce values to trimmed strings and drop blanks (a blank value means
//     "not provided", which is treated as missing for stage computation).
//
// Returns `{ values }` on success, `{ error }` on bad input.
export function parseCustomFieldValues(
  rawBody: unknown,
  templateFields: TemplateFieldShape[],
): { values: Record<string, string> } | { error: string } {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const incoming = body.customFieldValues;
  if (incoming === undefined || incoming === null) {
    return { values: {} };
  }
  if (typeof incoming !== "object" || Array.isArray(incoming)) {
    return { error: "customFieldValues must be an object of { fieldKey: value }" };
  }
  const allowed = new Set<string>();
  for (const f of templateFields) {
    if (f.source === "custom") allowed.add(f.fieldKey);
  }
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(incoming as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      return { error: `Unknown custom field key '${key}'` };
    }
    // Normalise the value to a string. Numbers and booleans are stringified;
    // arrays (multichoice) are JSON-encoded so we can round-trip them.
    let str = "";
    if (raw === null || raw === undefined) {
      str = "";
    } else if (typeof raw === "string") {
      str = raw.trim();
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      str = String(raw);
    } else if (Array.isArray(raw)) {
      // Filter to strings, drop blanks, then JSON-encode.
      const items = raw
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      str = items.length > 0 ? JSON.stringify(items) : "";
    } else {
      return { error: `customFieldValues.${key} has an unsupported value type` };
    }
    if (str.length > 0) out[key] = str;
  }
  return { values: out };
}

// Replace-all upsert: writes the supplied values, removes any existing rows for
// keys NOT in the new payload IF `replaceMissing` is true. We use replace mode
// from registration endpoints so editing a custom field back to blank actually
// clears it; downstream reads then see "missing" and stage drops accordingly.
export async function upsertFarmerCustomFieldValues(
  tx: Tx,
  farmerId: string,
  values: Record<string, string>,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  for (const [fieldKey, value] of entries) {
    await tx
      .insert(farmerCustomFieldValuesTable)
      .values({ farmerId, fieldKey, value })
      .onConflictDoUpdate({
        target: [farmerCustomFieldValuesTable.farmerId, farmerCustomFieldValuesTable.fieldKey],
        set: { value, updatedAt: new Date() },
      });
  }
}

// Same as above but also DELETES any rows for keys NOT in the new payload.
// Used by /complete and PATCH where the form is the authoritative snapshot.
export async function replaceFarmerCustomFieldValues(
  tx: Tx,
  farmerId: string,
  values: Record<string, string>,
): Promise<void> {
  await tx.delete(farmerCustomFieldValuesTable).where(eq(farmerCustomFieldValuesTable.farmerId, farmerId));
  await upsertFarmerCustomFieldValues(tx, farmerId, values);
}

export async function loadFarmerCustomFieldValues(farmerId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ fieldKey: farmerCustomFieldValuesTable.fieldKey, value: farmerCustomFieldValuesTable.value })
    .from(farmerCustomFieldValuesTable)
    .where(eq(farmerCustomFieldValuesTable.farmerId, farmerId));
  const out: Record<string, string> = {};
  for (const r of rows) out[r.fieldKey] = r.value ?? "";
  return out;
}
