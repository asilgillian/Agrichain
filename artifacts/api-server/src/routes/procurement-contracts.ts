import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, procurementContractsTable, groupsTable, auditLogsTable } from "@workspace/db";
import {
  CreateProcurementContractBody,
  UpdateProcurementContractBody,
  ListProcurementContractsQueryParams,
} from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

function generateContractNumber(type: string): string {
  const prefix = type === "PRE_SEASON" ? "PSC" : "PDC";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

function num(v: string | null | undefined): number | null {
  return v != null ? parseFloat(v) : null;
}

async function shape(c: typeof procurementContractsTable.$inferSelect) {
  const [group] = c.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, c.groupId))
    : [null as any];
  return {
    ...c,
    floorPricePerKg: num(c.floorPricePerKg),
    groupName: group?.name,
  };
}

router.get("/procurement/contracts", requirePermission("procurement.contracts.read"), async (req, res): Promise<void> => {
  const parsed = ListProcurementContractsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { groupId, status } = parsed.data;
  const conds: any[] = [];
  if (groupId) conds.push(eq(procurementContractsTable.groupId, groupId));
  if (status) conds.push(eq(procurementContractsTable.status, status));
  const rows = conds.length
    ? await db.select().from(procurementContractsTable).where(and(...conds)).orderBy(desc(procurementContractsTable.createdAt))
    : await db.select().from(procurementContractsTable).orderBy(desc(procurementContractsTable.createdAt));
  res.json(await Promise.all(rows.map(shape)));
});

router.post("/procurement/contracts", requirePermission("procurement.contracts.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateProcurementContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const effectiveStatus = data.status ?? "DRAFT";
  if (data.contractType === "PRE_SEASON" && effectiveStatus === "ACTIVE" && (data.floorPricePerKg == null)) {
    res.status(400).json({ error: "Active pre-season contracts must define floorPricePerKg" }); return;
  }
  const contractNumber = generateContractNumber(data.contractType);
  const [contract] = await db.insert(procurementContractsTable).values({
    contractNumber,
    contractType: data.contractType,
    groupId: data.groupId,
    commodityType: data.commodityType,
    seasonStart: data.seasonStart ? (data.seasonStart instanceof Date ? data.seasonStart.toISOString().slice(0, 10) : data.seasonStart) : null,
    seasonEnd: data.seasonEnd ? (data.seasonEnd instanceof Date ? data.seasonEnd.toISOString().slice(0, 10) : data.seasonEnd) : null,
    floorPricePerKg: data.floorPricePerKg != null ? data.floorPricePerKg.toString() : null,
    currency: data.currency ?? "UGX",
    notes: data.notes ?? null,
    status: data.status ?? "DRAFT",
    createdById: req.authedUser?.id ?? null,
  }).returning();
  await db.insert(auditLogsTable).values({
    entityType: "procurement_contract",
    entityId: contract.id,
    action: "create",
    actorId: req.authedUser?.id ?? "system",
    actorName: req.authedUser?.email ?? "system",
    actorRole: req.authedUser?.role ?? "system",
    after: { contractNumber, ...data },
  });
  res.status(201).json(await shape(contract));
});

router.patch("/procurement/contracts/:contractId", requirePermission("procurement.contracts.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = UpdateProcurementContractBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { contractId } = req.params;
  const updates: Partial<typeof procurementContractsTable.$inferInsert> = { updatedAt: new Date() };
  const d = parsed.data;
  if (d.floorPricePerKg !== undefined) updates.floorPricePerKg = d.floorPricePerKg != null ? d.floorPricePerKg.toString() : null;
  if (d.seasonStart !== undefined) updates.seasonStart = d.seasonStart instanceof Date ? d.seasonStart.toISOString().slice(0, 10) : d.seasonStart;
  if (d.seasonEnd !== undefined) updates.seasonEnd = d.seasonEnd instanceof Date ? d.seasonEnd.toISOString().slice(0, 10) : d.seasonEnd;
  if (d.notes !== undefined) updates.notes = d.notes;
  if (d.status !== undefined) updates.status = d.status;
  const [existing] = await db.select().from(procurementContractsTable).where(eq(procurementContractsTable.id, contractId as string));
  if (!existing) { res.status(404).json({ error: "Contract not found" }); return; }
  const nextStatus = updates.status ?? existing.status;
  const nextFloor = updates.floorPricePerKg !== undefined ? updates.floorPricePerKg : existing.floorPricePerKg;
  if (existing.contractType === "PRE_SEASON" && nextStatus === "ACTIVE" && (nextFloor == null)) {
    res.status(400).json({ error: "Active pre-season contracts must define floorPricePerKg" }); return;
  }
  const [contract] = await db.update(procurementContractsTable)
    .set(updates).where(eq(procurementContractsTable.id, contractId as string)).returning();
  await db.insert(auditLogsTable).values({
    entityType: "procurement_contract",
    entityId: contract.id,
    action: "update",
    actorId: req.authedUser?.id ?? "system",
    actorName: req.authedUser?.email ?? "system",
    actorRole: req.authedUser?.role ?? "system",
    after: d,
  });
  res.json(await shape(contract));
});

export default router;
