import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, regionsTable, rolesTable, farmersTable, groupsTable } from "@workspace/db";
import { CreateRegionBody, UpdateRolePermissionsBody, CreateFarmerBody, CreateGroupBody } from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

const PERMISSION_CATALOG: Array<{ key: string; module: string; description: string }> = [
  { key: "farmers.read", module: "Farmers", description: "View farmer records" },
  { key: "farmers.write", module: "Farmers", description: "Register and edit farmers" },
  { key: "groups.read", module: "Groups", description: "View cooperative groups" },
  { key: "groups.write", module: "Groups", description: "Create and edit groups" },
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
  { key: "procurement.contracts.read", module: "Procurement", description: "View pre-season and per-delivery contracts" },
  { key: "procurement.contracts.write", module: "Procurement", description: "Create and manage procurement contracts" },
  { key: "procurement.approve", module: "Procurement", description: "Legacy: combined approval (deprecated)" },
  { key: "deliveries.approve", module: "Procurement", description: "Legacy: final delivery approval (deprecated)" },
  { key: "warehouse.read", module: "Warehouse", description: "View warehouse lots and movements" },
  { key: "warehouse.write", module: "Warehouse", description: "Manage warehouse and lot transfers" },
  { key: "lots.write", module: "Warehouse", description: "Create and edit lots" },
  { key: "payments.read", module: "Payments", description: "View payment records" },
  { key: "payments.write", module: "Payments", description: "Initiate payments and disbursements" },
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
  { key: "admin.regions", module: "Admin", description: "Manage regions" },
  { key: "admin.roles", module: "Admin", description: "Manage roles and permissions" },
  { key: "admin.bulk_upload", module: "Admin", description: "Bulk upload master data (regions, farmers, groups)" },
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

router.get("/admin/regions", requirePermission("admin.regions"), async (_req, res): Promise<void> => {
  const regions = await db.select().from(regionsTable);
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

// ---------- BULK UPLOAD ----------

const BULK_VALIDATORS = {
  regions: CreateRegionBody,
  farmers: CreateFarmerBody,
  groups: CreateGroupBody,
} as const;
type BulkEntity = keyof typeof BULK_VALIDATORS;

async function generateFarmerReferenceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `FARM-${year}-${rand}`;
}

router.post("/admin/bulk-upload", requirePermission("admin.bulk_upload"), async (req, res): Promise<void> => {
  const body = req.body as { entityType?: string; rows?: unknown };
  const entityType = body?.entityType as BulkEntity | undefined;
  if (!entityType || !(entityType in BULK_VALIDATORS)) {
    res.status(400).json({ error: `entityType must be one of: ${Object.keys(BULK_VALIDATORS).join(", ")}` });
    return;
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

router.get("/admin/roles", requirePermission("admin.roles"), async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.name);
  res.json(roles.map(r => ({ id: r.id, name: r.name, description: r.description ?? undefined, permissions: r.permissions ?? [], isSystem: r.isSystem })));
});

router.post("/admin/roles", requirePermission("admin.roles"), async (req, res): Promise<void> => {
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
  res.status(201).json({ id: role.id, name: role.name, description: role.description ?? undefined, permissions: role.permissions ?? [], isSystem: role.isSystem });
});

router.patch("/admin/roles/:roleId/permissions", requirePermission("admin.roles"), async (req, res): Promise<void> => {
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
  const [role] = await db.update(rolesTable)
    .set({ permissions: parsed.data.permissions })
    .where(eq(rolesTable.id, roleId))
    .returning();
  if (!role) {
    res.status(404).json({ error: "Role not found" });
    return;
  }
  res.json({ id: role.id, name: role.name, description: role.description ?? undefined, permissions: role.permissions ?? [], isSystem: role.isSystem });
});

router.delete("/admin/roles/:roleId", requirePermission("admin.roles"), async (req, res): Promise<void> => {
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
