import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, regionsTable, rolesTable } from "@workspace/db";
import { CreateRegionBody, UpdateRolePermissionsBody } from "@workspace/api-zod";

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
  { key: "procurement.write", module: "Procurement", description: "Create deliveries, weight, and QC entries" },
  { key: "procurement.approve", module: "Procurement", description: "Approve procurement deliveries" },
  { key: "deliveries.approve", module: "Procurement", description: "Final delivery approval" },
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

router.get("/admin/regions", async (_req, res): Promise<void> => {
  const regions = await db.select().from(regionsTable);
  res.json(regions);
});

router.post("/admin/regions", async (req, res): Promise<void> => {
  const parsed = CreateRegionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [region] = await db.insert(regionsTable).values(parsed.data).returning();
  res.status(201).json(region);
});

router.get("/admin/permissions", async (_req, res): Promise<void> => {
  res.json(PERMISSION_CATALOG);
});

router.get("/admin/roles", async (_req, res): Promise<void> => {
  const roles = await db.select().from(rolesTable).orderBy(rolesTable.name);
  res.json(roles.map(r => ({ id: r.id, name: r.name, description: r.description ?? undefined, permissions: r.permissions ?? [], isSystem: r.isSystem })));
});

router.post("/admin/roles", async (req, res): Promise<void> => {
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

router.patch("/admin/roles/:roleId/permissions", async (req, res): Promise<void> => {
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

router.delete("/admin/roles/:roleId", async (req, res): Promise<void> => {
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

router.get("/admin/sync-queue", async (_req, res): Promise<void> => {
  res.json({
    pendingRecords: 3,
    failedRecords: 0,
    lastSyncAt: new Date().toISOString(),
    agentBreakdown: [],
  });
});

export default router;
