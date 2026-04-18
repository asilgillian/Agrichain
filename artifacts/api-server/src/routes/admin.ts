import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, regionsTable } from "@workspace/db";
import { CreateRegionBody, UpdateRolePermissionsBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/admin/regions", async (req, res): Promise<void> => {
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

router.get("/admin/roles", async (req, res): Promise<void> => {
  const roles = [
    { id: "agronomist", name: "Agronomist", permissions: ["farmers.read", "surveys.write", "visits.write"] },
    { id: "manager", name: "Manager", permissions: ["farmers.read", "farmers.write", "groups.write", "surveys.read", "procurement.read"] },
    { id: "supervisor", name: "Supervisor", permissions: ["farmers.read", "surveys.read", "surveys.review", "procurement.approve"] },
    { id: "procurement_head", name: "ProcurementHead", permissions: ["procurement.read", "procurement.approve", "deliveries.approve"] },
    { id: "finance", name: "FinanceOfficer", permissions: ["payments.read", "payments.write", "exports.read"] },
    { id: "system_admin", name: "SystemAdministrator", permissions: ["*"] },
    { id: "warehouse_manager", name: "WarehouseManager", permissions: ["warehouse.read", "warehouse.write", "lots.write"] },
    { id: "compliance_officer", name: "ComplianceOfficer", permissions: ["compliance.read", "certifications.write"] },
  ];
  res.json(roles);
});

router.patch("/admin/roles/:roleId/permissions", async (req, res): Promise<void> => {
  const { roleId } = req.params;
  const parsed = UpdateRolePermissionsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  res.json({ id: roleId as string, name: roleId as string, permissions: parsed.data.permissions });
});

router.get("/admin/sync-queue", async (req, res): Promise<void> => {
  res.json({
    pendingRecords: 3,
    failedRecords: 0,
    lastSyncAt: new Date().toISOString(),
    agentBreakdown: [],
  });
});

export default router;
