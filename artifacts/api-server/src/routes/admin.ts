import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  regionsTable,
  rolesTable,
  farmersTable,
  groupsTable,
  countryHierarchiesTable,
  auditLogsTable,
  UpsertCountryHierarchyBody,
  orgRegionsTable,
  commoditiesTable,
  commodityTypesTable,
  commodityPricesTable,
  buyingStationsTable,
  silosTable,
  storageBinsTable,
  usersTable,
} from "@workspace/db";
import { CreateRegionBody, UpdateRolePermissionsBody, CreateFarmerBody, CreateGroupBody } from "@workspace/api-zod";
import { z } from "zod/v4";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

// Lightweight audit helper for role/permission mutations. Always best-effort: a failure to
// write the audit row must not block the underlying admin action.
async function auditRoleChange(
  action: string,
  roleId: string,
  user: AuthedRequest["authedUser"],
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      entityType: "role",
      entityId: roleId,
      action,
      actorId: user?.id ?? "system",
      actorName: user?.email ?? "system",
      actorRole: user?.role ?? "system",
      before: before as any,
      after: after as any,
    });
  } catch {
    // Swallow — audit is observability, not gating.
  }
}

const PERMISSION_CATALOG: Array<{ key: string; module: string; description: string }> = [
  { key: "farmers.read", module: "Farmers", description: "View farmer records" },
  { key: "farmers.write", module: "Farmers", description: "Edit farmer records (legacy combined)" },
  { key: "farmers.preregister", module: "Farmer Registry", description: "Pre-register a farmer (minimal data capture)" },
  { key: "farmers.register", module: "Farmer Registry", description: "Complete full farmer registration with KYC" },
  { key: "plots.gps_map", module: "Farmer Registry", description: "Map farm plot GPS coordinates / polygon" },
  { key: "field.training.write", module: "Field Operations", description: "Capture training sessions and attendance" },
  { key: "field.gap.write", module: "Field Operations", description: "Conduct GAP (Good Agricultural Practice) assessments" },
  { key: "field.bulking.write", module: "Field Operations", description: "Create commodity bulking batches" },
  { key: "field.delivery.handover", module: "Field Operations", description: "Hand over batch to a buying station" },
  { key: "buying.truck_arrival", module: "Buying Station", description: "Record truck arrival and goods receipt" },
  { key: "groups.read", module: "Groups", description: "View cooperative groups" },
  { key: "groups.write", module: "Groups", description: "Create and edit groups" },
  { key: "groups.leaders.write", module: "Groups", description: "Appoint and end group leaders" },
  { key: "groups.transfer", module: "Groups", description: "Transfer and bulk-reassign farmers between groups" },
  { key: "groups.archive", module: "Groups", description: "Archive a group and redistribute members" },
  { key: "groups.assigned_only", module: "Groups", description: "Restrict groups/farmers visibility to those assigned to this user" },
  { key: "commodities.read", module: "Commodities", description: "View commodity catalog, types, prices, conversions" },
  { key: "commodities.write", module: "Commodities", description: "Create and edit commodities, types, conversions" },
  { key: "commodities.prices.write", module: "Commodities", description: "Set daily purchase prices per kg" },
  { key: "commodities.quality.write", module: "Commodities", description: "Define and version per-commodity QC parameters used by the Sampling Module" },
  { key: "plots.read", module: "Plots", description: "View plots and GPS data" },
  { key: "plots.write", module: "Plots", description: "Map and edit plots" },
  { key: "surveys.read", module: "Surveys", description: "View survey templates and submissions" },
  { key: "surveys.write", module: "Surveys", description: "Create surveys and submit responses" },
  { key: "surveys.review", module: "Surveys", description: "Review and approve survey responses" },
  { key: "visits.read", module: "Visits", description: "View field visit logs" },
  { key: "visits.write", module: "Visits", description: "Record field visits" },
  { key: "procurement.read", module: "Procurement", description: "View deliveries and procurement data" },
  { key: "procurement.write", module: "Procurement", description: "Create deliveries (legacy)" },
  { key: "procurement.weight.submit", module: "Procurement", description: "Submit gross/tare weight at offload" },
  { key: "procurement.weight.approve", module: "Procurement", description: "Approve submitted weight (must differ from submitter)" },
  { key: "procurement.qc.submit", module: "Procurement", description: "Submit quality assessment" },
  { key: "procurement.qc.approve", module: "Procurement", description: "Approve QC assessment (must differ from submitter)" },
  { key: "procurement.pricing.propose", module: "Procurement", description: "Trade desk: propose price, deductions, incentives" },
  { key: "procurement.pricing.approve", module: "Procurement", description: "Procurement head: approve final price (must differ from proposer)" },
  { key: "procurement.reject", module: "Procurement", description: "Reject a delivery at any gate (5 rejection types)" },
  { key: "procurement.resume", module: "Procurement", description: "Resume a delivery rejected as PARTIAL or ESCALATE (manager unblock)" },
  { key: "procurement.contracts.read", module: "Procurement", description: "View pre-season and per-delivery contracts" },
  { key: "procurement.contracts.write", module: "Procurement", description: "Create and manage procurement contracts" },
  { key: "procurement.approve", module: "Procurement", description: "Legacy: combined approval (deprecated)" },
  { key: "deliveries.approve", module: "Procurement", description: "Legacy: final delivery approval (deprecated)" },
  { key: "warehouse.read", module: "Warehouse", description: "View warehouse lots and movements" },
  { key: "warehouse.write", module: "Warehouse", description: "Manage warehouse and lot transfers" },
  { key: "lots.write", module: "Warehouse", description: "Create and edit lots" },
  { key: "payments.read", module: "Payments", description: "View payment records" },
  { key: "payments.write", module: "Payments", description: "Initiate payments and disbursements" },
  { key: "payments.disburse.cash", module: "Payments", description: "Pay farmers in cash (deducts from agent cash float)" },
  { key: "payments.disburse.momo", module: "Payments", description: "Pay farmers via Mobile Money (MTN / Airtel)" },
  { key: "loans.read", module: "Loans", description: "View loan records" },
  { key: "loans.write", module: "Loans", description: "Create and approve loans" },
  { key: "sales.read", module: "Sales", description: "View sales contracts" },
  { key: "sales.write", module: "Sales", description: "Create sales contracts" },
  { key: "exports.read", module: "Exports", description: "View export contracts and shipments" },
  { key: "exports.write", module: "Exports", description: "Create export contracts and shipments" },
  { key: "compliance.read", module: "Compliance", description: "View compliance and certifications" },
  { key: "compliance.write", module: "Compliance", description: "Schedule trainings and assessments" },
  { key: "certifications.write", module: "Compliance", description: "Manage certifications" },
  { key: "assets.read", module: "Assets", description: "View asset registry" },
  { key: "assets.write", module: "Assets", description: "Add and assign assets" },
  { key: "activity_funds.read", module: "Activity Funds", description: "View activity fund requests" },
  { key: "activity_funds.write", module: "Activity Funds", description: "Submit fund requests" },
  { key: "activity_funds.approve", module: "Activity Funds", description: "Approve or reject requests" },
  { key: "users.read", module: "Staff", description: "View staff users" },
  { key: "users.write", module: "Staff", description: "Add and edit staff" },
  { key: "regions.read", module: "Admin", description: "Read administrative regions (for pickers and lookups)" },
  { key: "hierarchy.read", module: "Admin", description: "Read per-country administrative hierarchies (for pickers)" },
  { key: "admin.regions", module: "Admin", description: "Manage regions" },
  { key: "admin.org_regions", module: "Admin", description: "Manage organisational regions (district clusters)" },
  { key: "admin.roles", module: "Admin", description: "Manage roles and permissions" },
  { key: "admin.bulk_upload", module: "Admin", description: "Bulk upload master data (regions, org regions, groups, farmers, commodities, commodity types, commodity prices, buying stations, silos, storage bins, users)" },
  { key: "admin.hierarchy", module: "Admin", description: "Configure per-country administrative hierarchies" },
  { key: "admin.registration_templates", module: "Admin", description: "Manage farmer registration survey templates" },
  { key: "admin.transaction_access", module: "Admin", description: "Configure registration-stage gates for transactions" },
  { key: "audit.read", module: "Audit", description: "View audit log" },
  { key: "*", module: "Admin", description: "Wildcard — full system access" },
];

const VALID_PERMISSION_KEYS = new Set(PERMISSION_CATALOG.map(p => p.key));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCreateRoleBody(body: unknown):
  | { ok: true; data: { name: string; description?: string; permissions: string[] } }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Body must be an object" };
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || b.name.trim().length < 2) return { ok: false, error: "name must be a string of at least 2 chars" };
  if (b.description !== undefined && typeof b.description !== "string") return { ok: false, error: "description must be a string" };
  if (!Array.isArray(b.permissions) || !b.permissions.every(p => typeof p === "string")) return { ok: false, error: "permissions must be an array of strings" };
  return { ok: true, data: { name: b.name.trim(), description: b.description as string | undefined, permissions: b.permissions as string[] } };
}

// Read-only list — used by the cascading region picker in every farmer/group form
// across web and mobile. Gate by the lighter `regions.read` so field staff can
// populate the picker without granting them write access to admin tables.
router.get("/admin/regions", requirePermission("regions.read"), async (_req, res): Promise<void> => {
  // Exclude `boundary` (jsonb polygon) — it's only needed by the map and is fetched
  // separately via /admin/regions/geojson. Including it here blows the payload to
  // 50–100MB+ once admin-unit shapefiles are imported and locks up the Regions tab.
  const regions = await db.select({
    id: regionsTable.id,
    name: regionsTable.name,
    parentId: regionsTable.parentId,
    level: regionsTable.level,
    countryCode: regionsTable.countryCode,
    code: regionsTable.code,
    isActive: regionsTable.isActive,
    createdAt: regionsTable.createdAt,
    updatedAt: regionsTable.updatedAt,
  }).from(regionsTable);
  res.json(regions);
});

router.post("/admin/regions", requirePermission("admin.regions"), async (req, res): Promise<void> => {
  const parsed = CreateRegionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [region] = await db.insert(regionsTable).values(parsed.data).returning();
  res.status(201).json(region);
});

// ---------- COUNTRY HIERARCHIES ----------

const DEFAULT_HIERARCHIES = [
  {
    countryCode: "UG",
    countryName: "Uganda",
    levels: [
      { level: 1, name: "District" },
      { level: 2, name: "Sub-county" },
      { level: 3, name: "Parish" },
      { level: 4, name: "Village" },
    ],
  },
  {
    countryCode: "KE",
    countryName: "Kenya",
    levels: [
      { level: 1, name: "County" },
      { level: 2, name: "Sub-county" },
      { level: 3, name: "Location" },
      { level: 4, name: "Village" },
    ],
  },
  {
    countryCode: "TZ",
    countryName: "Tanzania",
    levels: [
      { level: 1, name: "Region" },
      { level: 2, name: "District" },
      { level: 3, name: "Ward" },
      { level: 4, name: "Village" },
    ],
  },
  {
    countryCode: "RW",
    countryName: "Rwanda",
    levels: [
      { level: 1, name: "Province" },
      { level: 2, name: "District" },
      { level: 3, name: "Sector" },
      { level: 4, name: "Cell" },
      { level: 5, name: "Village" },
    ],
  },
];

let seededOnce = false;
async function ensureSeedHierarchiesOnce(): Promise<void> {
  if (seededOnce) return;
  const existing = await db.select().from(countryHierarchiesTable);
  if (existing.length === 0) {
    for (const seed of DEFAULT_HIERARCHIES) {
      await db.insert(countryHierarchiesTable).values(seed);
    }
  }
  seededOnce = true;
}

// Read-only — needed by every cascading region picker to know level names
// (District / Sub-county / Parish / Village). Lighter `hierarchy.read` perm.
router.get("/admin/country-hierarchies", requirePermission("hierarchy.read"), async (_req, res): Promise<void> => {
  await ensureSeedHierarchiesOnce();
  const rows = await db.select().from(countryHierarchiesTable);
  rows.sort((a, b) => a.countryName.localeCompare(b.countryName));
  res.json(rows);
});

router.get("/admin/country-hierarchies/:countryCode", requirePermission("hierarchy.read"), async (req, res): Promise<void> => {
  const code = String(req.params.countryCode).toUpperCase();
  const [row] = await db.select().from(countryHierarchiesTable).where(eq(countryHierarchiesTable.countryCode, code));
  if (!row) { res.status(404).json({ error: "Country hierarchy not found" }); return; }
  res.json(row);
});

router.put("/admin/country-hierarchies/:countryCode", requirePermission("admin.hierarchy"), async (req, res): Promise<void> => {
  const code = String(req.params.countryCode).toUpperCase();
  const parsed = UpsertCountryHierarchyBody.safeParse({
    ...((req.body && typeof req.body === "object") ? req.body : {}),
    countryCode: ((req.body as any)?.countryCode ?? code).toString().toUpperCase(),
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") });
    return;
  }
  if (parsed.data.countryCode !== code) {
    res.status(400).json({ error: "countryCode in path does not match body" });
    return;
  }
  const countryName = parsed.data.countryName.trim();
  if (countryName.length < 2) {
    res.status(400).json({ error: "countryName must be at least 2 non-whitespace characters" });
    return;
  }
  const levels = parsed.data.levels
    .slice()
    .sort((a, b) => a.level - b.level)
    .map((l, i) => ({ level: i + 1, name: l.name.trim() }));
  if (levels.some(l => l.name.length === 0)) {
    res.status(400).json({ error: "Level names cannot be empty or whitespace" });
    return;
  }
  if (new Set(levels.map(l => l.name.toLowerCase())).size !== levels.length) {
    res.status(400).json({ error: "Level names must be unique within a country" });
    return;
  }

  const [existing] = await db.select().from(countryHierarchiesTable).where(eq(countryHierarchiesTable.countryCode, code));
  let saved;
  if (existing) {
    [saved] = await db.update(countryHierarchiesTable)
      .set({ countryName, levels, updatedAt: new Date() })
      .where(eq(countryHierarchiesTable.countryCode, code))
      .returning();
  } else {
    [saved] = await db.insert(countryHierarchiesTable)
      .values({ countryCode: code, countryName, levels })
      .returning();
  }
  res.json(saved);
});

router.delete("/admin/country-hierarchies/:countryCode", requirePermission("admin.hierarchy"), async (req, res): Promise<void> => {
  const code = String(req.params.countryCode).toUpperCase();
  await db.delete(countryHierarchiesTable).where(eq(countryHierarchiesTable.countryCode, code));
  res.status(204).end();
});

// ---------- BULK UPLOAD ----------

// Shared coercers: CSV upload delivers every cell as a string, so numeric / boolean / uuid columns
// must be coerced. Optional fields use `z.preprocess` to convert empty-string → undefined first so
// the optional() branch kicks in rather than failing coercion on "".
const optStr = z.preprocess((v: unknown) => (v === "" || v == null ? undefined : v), z.string().optional());
const optTrimmedStr = z.preprocess(
  (v: unknown) => (v === "" || v == null ? undefined : String(v).trim()),
  z.string().min(1).optional(),
);
const optUuid = z.preprocess(
  (v: unknown) => (v === "" || v == null ? undefined : v),
  z.string().uuid().optional(),
);
const optNum = z.preprocess(
  (v: unknown) => (v === "" || v == null ? undefined : v),
  z.coerce.number().optional(),
);
const optBool = z.preprocess((v: unknown) => {
  if (v === "" || v == null) return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "y", "t"].includes(s)) return true;
  if (["false", "0", "no", "n", "f"].includes(s)) return false;
  return v;
}, z.boolean().optional());
const dateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

const OrgRegionBulkRow = z.object({
  name: z.string().min(1),
  description: optStr,
  countryCode: optTrimmedStr,
  isActive: optBool,
});

const CommodityBulkRow = z.object({
  name: z.string().min(1),
  code: z.string().min(1),
  scientificName: optStr,
  defaultUnit: optTrimmedStr,
  description: optStr,
  status: optTrimmedStr,
});

const CommodityTypeBulkRow = z.object({
  commodityId: z.string().uuid(),
  name: z.string().min(1),
  code: z.string().min(1),
  stage: optTrimmedStr,
  parentCommodityTypeId: optUuid,
  isPurchasable: optBool,
  isSellable: optBool,
  defaultUnit: optTrimmedStr,
  defaultMoistureMin: optNum,
  defaultMoistureMax: optNum,
  status: optTrimmedStr,
});

const CommodityPriceBulkRow = z.object({
  commodityTypeId: z.string().uuid(),
  regionId: optUuid,
  pricePerKg: z.coerce.number().positive(),
  currency: optTrimmedStr,
  effectiveDate: dateYmd,
  source: optTrimmedStr,
  notes: optStr,
});

const BuyingStationBulkRow = z.object({
  name: z.string().min(1),
  location: optStr,
  gpsLat: optNum,
  gpsLng: optNum,
  managerUserId: optUuid,
  isActive: optBool,
});

const SiloBulkRow = z.object({
  name: z.string().min(1),
  facilityId: optStr,
  stream: z.string().min(1),
  commodityType: optStr,
  capacityKg: optNum,
  status: optTrimmedStr,
});

const StorageBinBulkRow = z.object({
  name: z.string().min(1),
  facilityId: optStr,
  stream: z.string().min(1),
  commodityType: optStr,
  capacityKg: optNum,
  isActive: optBool,
});

const UserBulkRow = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phoneNumber: optStr,
  clerkUserId: optStr,
  role: z.string().min(1),
  regionId: optUuid,
  managerId: optUuid,
  status: optTrimmedStr,
});

const BULK_VALIDATORS = {
  regions: CreateRegionBody,
  farmers: CreateFarmerBody,
  groups: CreateGroupBody,
  org_regions: OrgRegionBulkRow,
  commodities: CommodityBulkRow,
  commodity_types: CommodityTypeBulkRow,
  commodity_prices: CommodityPriceBulkRow,
  buying_stations: BuyingStationBulkRow,
  silos: SiloBulkRow,
  storage_bins: StorageBinBulkRow,
  users: UserBulkRow,
} as const;
type BulkEntity = keyof typeof BULK_VALIDATORS;

// Strip undefined keys so Drizzle defaults (e.g. `status` default 'active') apply rather than
// being explicitly overwritten with NULL.
function stripUndefined<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

async function generateFarmerReferenceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FARM-${year}-${rand}`;
}

// Per-entity additional permission gate. `admin.bulk_upload` is the base ticket to use this
// endpoint at all, but for sensitive entities (especially `users`, which can mint accounts with
// arbitrary roles) we require the corresponding write permission on top. This prevents an
// operator who is allowed to bulk-load reference data from escalating to user provisioning or
// price manipulation.
const BULK_ENTITY_EXTRA_PERMS: Record<BulkEntity, string | null> = {
  regions: "admin.regions",
  org_regions: "admin.org_regions",
  groups: "groups.write",
  farmers: "farmers.write",
  commodities: "commodities.write",
  commodity_types: "commodities.write",
  commodity_prices: "commodities.prices.write",
  buying_stations: "warehouse.write",
  silos: "warehouse.write",
  storage_bins: "warehouse.write",
  users: "users.write",
};

router.post("/admin/bulk-upload", requirePermission("admin.bulk_upload"), async (req: AuthedRequest, res): Promise<void> => {
  const body = req.body as { entityType?: string; rows?: unknown };
  const entityType = body?.entityType as BulkEntity | undefined;
  if (!entityType || !(entityType in BULK_VALIDATORS)) {
    res.status(400).json({ error: `entityType must be one of: ${Object.keys(BULK_VALIDATORS).join(", ")}` });
    return;
  }
  const extraPerm = BULK_ENTITY_EXTRA_PERMS[entityType];
  if (extraPerm) {
    const userPerms = new Set(req.authedUser?.permissions ?? []);
    if (!userPerms.has("*") && !userPerms.has(extraPerm)) {
      res.status(403).json({ error: `Bulk uploading "${entityType}" also requires the "${extraPerm}" permission` });
      return;
    }
  }
  if (!Array.isArray(body.rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }
  if (body.rows.length === 0) {
    res.status(400).json({ error: "rows cannot be empty" });
    return;
  }
  if (body.rows.length > 1000) {
    res.status(400).json({ error: "Maximum 1000 rows per upload" });
    return;
  }

  const validator = BULK_VALIDATORS[entityType];
  const created: any[] = [];
  const errors: Array<{ row: number; error: string; data: unknown }> = [];

  for (let i = 0; i < body.rows.length; i++) {
    const raw = body.rows[i];
    const parsed = validator.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row: i + 1, error: parsed.error.issues.map(iss => `${iss.path.join(".")}: ${iss.message}`).join("; "), data: raw });
      continue;
    }
    try {
      if (entityType === "regions") {
        const [r] = await db.insert(regionsTable).values(parsed.data as any).returning();
        created.push(r);
      } else if (entityType === "groups") {
        const [g] = await db.insert(groupsTable).values(parsed.data as any).returning();
        created.push(g);
      } else if (entityType === "farmers") {
        const referenceNumber = await generateFarmerReferenceNumber();
        const data = parsed.data as any;
        const [f] = await db.insert(farmersTable).values({
          ...data,
          referenceNumber,
          dateOfBirth: data.dateOfBirth instanceof Date ? data.dateOfBirth.toISOString().slice(0, 10) : data.dateOfBirth,
        }).returning();
        created.push(f);
      } else if (entityType === "org_regions") {
        const [r] = await db.insert(orgRegionsTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "commodities") {
        const [r] = await db.insert(commoditiesTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "commodity_types") {
        const [r] = await db.insert(commodityTypesTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "commodity_prices") {
        const [r] = await db.insert(commodityPricesTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "buying_stations") {
        const [r] = await db.insert(buyingStationsTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "silos") {
        const [r] = await db.insert(silosTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "storage_bins") {
        const [r] = await db.insert(storageBinsTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      } else if (entityType === "users") {
        const [r] = await db.insert(usersTable).values(stripUndefined(parsed.data) as any).returning();
        created.push(r);
      }
    } catch (err: any) {
      errors.push({ row: i + 1, error: err?.message ?? "Insert failed", data: raw });
    }
  }

  res.status(201).json({
    entityType,
    totalSubmitted: body.rows.length,
    createdCount: created.length,
    errorCount: errors.length,
    created,
    errors,
  });
});

router.get("/admin/permissions", requirePermission("admin.roles"), async (_req, res): Promise<void> => {
  res.json(PERMISSION_CATALOG);
});

// Pre-built permission templates the admin can apply to a role as a starting point. Templates are
// static (defined here rather than in the DB) because they're reference defaults — admins are
// expected to copy + customize them per role rather than mutate the canonical template.
const PERMISSION_TEMPLATES: Array<{ name: string; description: string; permissions: string[] }> = [
  {
    name: "Field Manager",
    description: "Field-level operations: register farmers, map plots, capture surveys, run trainings and GAP assessments, create bulking batches and hand them over to a buying station.",
    permissions: [
      "farmers.read", "farmers.preregister", "farmers.register",
      "plots.read", "plots.gps_map", "plots.write",
      "groups.read", "groups.write",
      "surveys.read", "surveys.write",
      "visits.read", "visits.write",
      "field.training.write", "field.gap.write", "field.bulking.write", "field.delivery.handover",
      "commodities.read",
    ],
  },
  {
    name: "Area Supervisor",
    description: "Area oversight: read-only across farmer ops + survey review, plus group transfers and visit oversight.",
    permissions: [
      "farmers.read", "plots.read", "groups.read", "groups.transfer",
      "surveys.read", "surveys.review",
      "visits.read", "visits.write",
      "field.training.write", "field.gap.write",
      "compliance.read",
      "procurement.read",
    ],
  },
  {
    name: "Regional Manager",
    description: "Regional reporting + group governance + procurement read + activity-fund approval.",
    permissions: [
      "farmers.read", "plots.read",
      "groups.read", "groups.write", "groups.leaders.write", "groups.transfer", "groups.archive",
      "surveys.read", "surveys.review", "visits.read",
      "procurement.read", "procurement.contracts.read",
      "warehouse.read", "payments.read", "loans.read", "sales.read",
      "compliance.read", "certifications.write",
      "activity_funds.read", "activity_funds.approve",
      "audit.read", "users.read",
    ],
  },
  {
    name: "Buying Station Agent",
    description: "Buying-station floor: receive trucks, submit weights and QC samples, view contracts.",
    permissions: [
      "buying.truck_arrival",
      "procurement.read", "procurement.weight.submit", "procurement.qc.submit",
      "procurement.contracts.read",
      "warehouse.read", "lots.write",
      "farmers.read", "groups.read", "commodities.read",
    ],
  },
];

router.get("/admin/permission-templates", requirePermission("admin.roles"), async (_req, res): Promise<void> => {
  res.json(PERMISSION_TEMPLATES);
});

router.get("/admin/roles", requirePermission("admin.roles"), async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.name);
  res.json(roles.map(r => ({ id: r.id, name: r.name, description: r.description ?? undefined, permissions: r.permissions ?? [], isSystem: r.isSystem })));
});

router.post("/admin/roles", requirePermission("admin.roles"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = parseCreateRoleBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const invalid = parsed.data.permissions.filter(p => !VALID_PERMISSION_KEYS.has(p));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown permissions: ${invalid.join(", ")}` });
    return;
  }
  const existing = await db.select().from(rolesTable).where(eq(rolesTable.name, parsed.data.name));
  if (existing.length > 0) {
    res.status(409).json({ error: "A role with that name already exists" });
    return;
  }
  const [role] = await db.insert(rolesTable).values({
    name: parsed.data.name,
    description: parsed.data.description,
    permissions: parsed.data.permissions,
    isSystem: false,
  }).returning();
  await auditRoleChange("role.create", role.id, req.authedUser, null, {
    name: role.name,
    description: role.description ?? null,
    permissions: role.permissions ?? [],
  });
  res.status(201).json({ id: role.id, name: role.name, description: role.description ?? undefined, permissions: role.permissions ?? [], isSystem: role.isSystem });
});

router.patch("/admin/roles/:roleId/permissions", requirePermission("admin.roles"), async (req: AuthedRequest, res): Promise<void> => {
  const { roleId } = req.params;
  if (!UUID_RE.test(roleId)) {
    res.status(400).json({ error: "Invalid roleId" });
    return;
  }
  const parsed = UpdateRolePermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const invalid = parsed.data.permissions.filter(p => !VALID_PERMISSION_KEYS.has(p));
  if (invalid.length > 0) {
    res.status(400).json({ error: `Unknown permissions: ${invalid.join(", ")}` });
    return;
  }
  const [prior] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
  if (!prior) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  const [role] = await db.update(rolesTable)
    .set({ permissions: parsed.data.permissions })
    .where(eq(rolesTable.id, roleId))
    .returning();
  // Compute the diff so the audit log answers "what changed" without forcing a reader to compare arrays.
  const oldSet = new Set(prior.permissions ?? []);
  const newSet = new Set(role.permissions ?? []);
  const added = [...newSet].filter(p => !oldSet.has(p));
  const removed = [...oldSet].filter(p => !newSet.has(p));
  await auditRoleChange(
    "role.permissions.update",
    role.id,
    req.authedUser,
    { permissions: prior.permissions ?? [] },
    { permissions: role.permissions ?? [], added, removed },
  );
  res.json({ id: role.id, name: role.name, description: role.description ?? undefined, permissions: role.permissions ?? [], isSystem: role.isSystem });
});

router.delete("/admin/roles/:roleId", requirePermission("admin.roles"), async (req: AuthedRequest, res): Promise<void> => {
  const { roleId } = req.params;
  if (!UUID_RE.test(roleId)) {
    res.status(400).json({ error: "Invalid roleId" });
    return;
  }
  const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
  if (!existing) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  if (existing.isSystem) {
    res.status(400).json({ error: "System roles cannot be deleted" });
    return;
  }
  await db.delete(rolesTable).where(eq(rolesTable.id, roleId));
  await auditRoleChange("role.delete", existing.id, req.authedUser, {
    name: existing.name,
    description: existing.description ?? null,
    permissions: existing.permissions ?? [],
  }, null);
  res.status(204).end();
});

router.get("/admin/sync-queue", requirePermission("admin.roles"), async (_req, res): Promise<void> => {
  res.json({
    pendingRecords: 3,
    failedRecords: 0,
    lastSyncAt: new Date().toISOString(),
    agentBreakdown: [],
  });
});

export default router;
