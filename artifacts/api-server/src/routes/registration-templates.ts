import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, desc } from "drizzle-orm";
import {
  db,
  registrationTemplatesTable,
  registrationTemplateFieldsTable,
} from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { KNOWN_CORE_FIELDS, KNOWN_CORE_FIELD_KEYS, getCoreFieldDef } from "../lib/known-registration-fields";
import { getActiveTemplate } from "../lib/registration-stage";

const router: IRouter = Router();

const VALID_FIELD_TYPES = new Set(["text", "number", "date", "choice", "multichoice", "yesno"]);
const VALID_SOURCES = new Set(["core_farmer", "core_livelihood", "custom"]);

// ---------- PUBLIC: catalog of toggleable core fields ----------
// Mobile + web back-office both call this so they can show admins what knobs
// exist without hardcoding the catalog client-side.
router.get("/registration-templates/core-fields", async (_req, res): Promise<void> => {
  // Normalize catalog shape to match the DB-returned template field rows
  // (`fieldKey` rather than `key`). Both the web admin builder and the mobile
  // dynamic form rely on a consistent `{fieldKey, label, fieldType, source,
  // options, alwaysRequired}` contract — without this mapping, clicking a
  // core-field chip in the admin pushes a row with `fieldKey: undefined`,
  // which the PUT /fields endpoint then rejects with 400.
  res.json(
    KNOWN_CORE_FIELDS.map((f) => ({
      fieldKey: f.key,
      label: f.label,
      fieldType: f.fieldType,
      source: f.source,
      options: f.options ?? null,
      alwaysRequired: !!f.alwaysRequired,
    })),
  );
});

// ---------- PUBLIC: fetch the active template for a country ----------
// Any signed-in user (field agents on mobile, back-office staff on web) can read
// the active template — they need it to render the registration form dynamically.
// Returns the country-specific template if one exists, else falls back to the
// global (country_code IS NULL) template, else 200 with `{template:null,fields:[]}`
// so clients know to render their built-in defaults.
router.get("/registration-templates/active", async (req: AuthedRequest, res): Promise<void> => {
  const countryCode =
    typeof req.query.countryCode === "string" && req.query.countryCode.trim()
      ? req.query.countryCode.trim().toUpperCase()
      : null;
  const tpl = await getActiveTemplate(countryCode);
  if (!tpl) {
    res.json({ template: null, fields: [] });
    return;
  }
  // Return the full template metadata too so the UI can show "version 3 — Uganda"
  // alongside the field list.
  const [meta] = await db
    .select()
    .from(registrationTemplatesTable)
    .where(eq(registrationTemplatesTable.id, tpl.templateId));
  res.json({ template: meta ?? null, fields: tpl.fields });
});

// ---------- ADMIN: list all templates ----------
router.get(
  "/admin/registration-templates",
  requirePermission("admin.registration_templates"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select()
      .from(registrationTemplatesTable)
      .orderBy(desc(registrationTemplatesTable.updatedAt));
    res.json(rows);
  },
);

// ---------- ADMIN: get one template + its fields ----------
router.get(
  "/admin/registration-templates/:id",
  requirePermission("admin.registration_templates"),
  async (req: AuthedRequest, res): Promise<void> => {
    const id = req.params.id as string;
    const [tpl] = await db
      .select()
      .from(registrationTemplatesTable)
      .where(eq(registrationTemplatesTable.id, id));
    if (!tpl) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const fields = await db
      .select()
      .from(registrationTemplateFieldsTable)
      .where(eq(registrationTemplateFieldsTable.templateId, id))
      .orderBy(asc(registrationTemplateFieldsTable.sortOrder));
    res.json({ template: tpl, fields });
  },
);

// ---------- ADMIN: create a new template ----------
// Defaults to inactive. Admin "activates" it via the dedicated endpoint below
// (which atomically deactivates any other active template for the same scope).
router.post(
  "/admin/registration-templates",
  requirePermission("admin.registration_templates"),
  async (req: AuthedRequest, res): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      res.status(400).json({ error: "name is required" });
      return;
    }
    const description = typeof body.description === "string" ? body.description.trim() : null;
    const countryCode =
      typeof body.countryCode === "string" && body.countryCode.trim()
        ? body.countryCode.trim().toUpperCase()
        : null;
    const [created] = await db
      .insert(registrationTemplatesTable)
      .values({ name, description, countryCode, isActive: false })
      .returning();
    res.status(201).json(created);
  },
);

// ---------- ADMIN: patch template metadata (name/description/country) ----------
router.patch(
  "/admin/registration-templates/:id",
  requirePermission("admin.registration_templates"),
  async (req: AuthedRequest, res): Promise<void> => {
    const id = req.params.id as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.description === "string") patch.description = body.description.trim() || null;
    if (typeof body.countryCode === "string") {
      patch.countryCode = body.countryCode.trim() ? body.countryCode.trim().toUpperCase() : null;
    }
    const [updated] = await db
      .update(registrationTemplatesTable)
      .set(patch)
      .where(eq(registrationTemplatesTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(updated);
  },
);

// ---------- ADMIN: activate a template ----------
// Atomically deactivates any currently-active template for the same scope (same
// country code, or both global) before activating this one, so the partial
// unique idx in the schema never blocks the swap.
router.post(
  "/admin/registration-templates/:id/activate",
  requirePermission("admin.registration_templates"),
  async (req: AuthedRequest, res): Promise<void> => {
    const id = req.params.id as string;
    const [tpl] = await db
      .select()
      .from(registrationTemplatesTable)
      .where(eq(registrationTemplatesTable.id, id));
    if (!tpl) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    await db.transaction(async (tx) => {
      // Deactivate any other active template for the same scope.
      if (tpl.countryCode) {
        await tx
          .update(registrationTemplatesTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(registrationTemplatesTable.isActive, true),
              eq(registrationTemplatesTable.countryCode, tpl.countryCode),
            ),
          );
      } else {
        await tx
          .update(registrationTemplatesTable)
          .set({ isActive: false, updatedAt: new Date() })
          .where(
            and(
              eq(registrationTemplatesTable.isActive, true),
              isNull(registrationTemplatesTable.countryCode),
            ),
          );
      }
      await tx
        .update(registrationTemplatesTable)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(registrationTemplatesTable.id, id));
    });
    res.json({ ok: true });
  },
);

// ---------- ADMIN: replace the entire field set for a template ----------
// One-shot replace simplifies the admin UI: it sends the full ordered field
// list, server wipes & re-inserts inside a transaction. This avoids ID
// management on the client and ordering drift bugs. Validates that core fields
// reference a known catalog key and that custom fields don't collide with core
// keys.
router.put(
  "/admin/registration-templates/:id/fields",
  requirePermission("admin.registration_templates"),
  async (req: AuthedRequest, res): Promise<void> => {
    const id = req.params.id as string;
    const [tpl] = await db
      .select()
      .from(registrationTemplatesTable)
      .where(eq(registrationTemplatesTable.id, id));
    if (!tpl) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    const rawFields = (req.body as Record<string, unknown> | undefined)?.fields;
    if (!Array.isArray(rawFields)) {
      res.status(400).json({ error: "body.fields must be an array" });
      return;
    }

    // Validate every entry up-front so we either accept or reject the whole submit.
    type IncomingField = {
      fieldKey: string;
      label: string;
      fieldType: string;
      required: boolean;
      source: "core_farmer" | "core_livelihood" | "custom";
      options: { value: string; label: string }[] | null;
      sortOrder: number;
    };
    const cleaned: IncomingField[] = [];
    const seenKeys = new Set<string>();
    for (let i = 0; i < rawFields.length; i++) {
      const f = rawFields[i] as Record<string, unknown>;
      if (!f || typeof f !== "object") {
        res.status(400).json({ error: `fields[${i}] must be an object` });
        return;
      }
      const fieldKey = typeof f.fieldKey === "string" ? f.fieldKey.trim() : "";
      const source = typeof f.source === "string" ? f.source : "";
      const fieldType = typeof f.fieldType === "string" ? f.fieldType : "";
      const label = typeof f.label === "string" ? f.label.trim() : "";
      if (!fieldKey || !VALID_SOURCES.has(source) || !VALID_FIELD_TYPES.has(fieldType) || !label) {
        res.status(400).json({ error: `fields[${i}] is missing required attributes` });
        return;
      }
      if (seenKeys.has(fieldKey)) {
        res.status(400).json({ error: `Duplicate field key '${fieldKey}'` });
        return;
      }
      seenKeys.add(fieldKey);

      // Core fields must match the catalog (key + type + source). Custom fields
      // must NOT collide with a core key.
      if (source === "core_farmer" || source === "core_livelihood") {
        const def = getCoreFieldDef(fieldKey);
        if (!def) {
          res.status(400).json({ error: `Unknown core field key '${fieldKey}'` });
          return;
        }
        if (def.source !== source || def.fieldType !== fieldType) {
          res.status(400).json({ error: `Core field '${fieldKey}' has the wrong source/type` });
          return;
        }
      } else if (source === "custom" && KNOWN_CORE_FIELD_KEYS.has(fieldKey)) {
        res.status(400).json({ error: `Custom field key '${fieldKey}' collides with a core field` });
        return;
      }

      // Always-required core fields can't be marked optional.
      const def = getCoreFieldDef(fieldKey);
      const required = def?.alwaysRequired ? true : Boolean(f.required);

      // Options are only meaningful for choice/multichoice. Strip otherwise.
      let options: IncomingField["options"] = null;
      if (fieldType === "choice" || fieldType === "multichoice") {
        if (Array.isArray(f.options)) {
          const parsedOpts: { value: string; label: string }[] = [];
          for (const opt of f.options as unknown[]) {
            if (!opt || typeof opt !== "object") continue;
            const o = opt as Record<string, unknown>;
            const value = typeof o.value === "string" ? o.value.trim() : "";
            const optLabel = typeof o.label === "string" ? o.label.trim() : value;
            if (value) parsedOpts.push({ value, label: optLabel });
          }
          options = parsedOpts.length > 0 ? parsedOpts : null;
        }
        // For core choice fields, fall back to the catalog options so admins
        // don't have to retype them when they just want to mark required.
        if (!options && def?.options) options = def.options;
      }

      cleaned.push({
        fieldKey,
        label,
        fieldType,
        required,
        source: source as IncomingField["source"],
        options,
        sortOrder: typeof f.sortOrder === "number" ? f.sortOrder : i,
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(registrationTemplateFieldsTable)
        .where(eq(registrationTemplateFieldsTable.templateId, id));
      if (cleaned.length > 0) {
        await tx.insert(registrationTemplateFieldsTable).values(
          cleaned.map((c) => ({
            templateId: id,
            fieldKey: c.fieldKey,
            label: c.label,
            fieldType: c.fieldType,
            required: c.required,
            source: c.source,
            options: c.options as unknown,
            sortOrder: c.sortOrder,
            isActive: true,
          })),
        );
      }
      await tx
        .update(registrationTemplatesTable)
        .set({ updatedAt: new Date() })
        .where(eq(registrationTemplatesTable.id, id));
    });

    const fields = await db
      .select()
      .from(registrationTemplateFieldsTable)
      .where(eq(registrationTemplateFieldsTable.templateId, id))
      .orderBy(asc(registrationTemplateFieldsTable.sortOrder));
    res.json({ fields });
  },
);

// ---------- ADMIN: delete a template ----------
// Refuses to delete an active template. Cascade drops its fields automatically.
router.delete(
  "/admin/registration-templates/:id",
  requirePermission("admin.registration_templates"),
  async (req: AuthedRequest, res): Promise<void> => {
    const id = req.params.id as string;
    const [tpl] = await db
      .select()
      .from(registrationTemplatesTable)
      .where(eq(registrationTemplatesTable.id, id));
    if (!tpl) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (tpl.isActive) {
      res
        .status(409)
        .json({ error: "Cannot delete an active template. Activate another one first.", code: "TEMPLATE_ACTIVE" });
      return;
    }
    await db.delete(registrationTemplatesTable).where(eq(registrationTemplatesTable.id, id));
    res.json({ ok: true });
  },
);

export default router;
