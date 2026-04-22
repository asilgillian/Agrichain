import { Router, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import {
  db,
  procurementWorkflowsTable,
  procurementWorkflowStagesTable,
  auditLogsTable,
  STAGE_KINDS,
} from "@workspace/db";
import {
  CreateProcurementWorkflowBody,
  UpdateProcurementWorkflowBody,
  AddWorkflowStageBody,
  UpdateWorkflowStageBody,
  ReorderWorkflowStagesBody,
} from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

// Default permission per stage kind — used when a stage row leaves requiredPermission null.
export const DEFAULT_STAGE_PERMISSION: Record<string, string> = {
  WEIGHT_SUBMIT: "procurement.weight.submit",
  WEIGHT_APPROVE: "procurement.weight.approve",
  QC_SUBMIT: "procurement.qc.submit",
  QC_APPROVE: "procurement.qc.approve",
  PRICING_PROPOSE: "procurement.pricing.propose",
  PRICING_APPROVE: "procurement.pricing.approve",
  INFO_CHECKPOINT: "procurement.write",
};

// Default canonical workflow seeded on first read if no workflow exists.
const DEFAULT_STAGES: Array<{ stageKind: string; displayName: string; description: string }> = [
  { stageKind: "WEIGHT_SUBMIT", displayName: "Submit Weight", description: "Weighbridge operator captures gross / tare." },
  { stageKind: "WEIGHT_APPROVE", displayName: "Approve Weight", description: "Supervisor confirms weighbridge entry." },
  { stageKind: "QC_SUBMIT", displayName: "Submit QC", description: "Lab tech captures moisture, defects, cup score." },
  { stageKind: "QC_APPROVE", displayName: "Approve QC", description: "QC head signs off on grade." },
  { stageKind: "PRICING_PROPOSE", displayName: "Propose Pricing", description: "Trade desk proposes price per kg." },
  { stageKind: "PRICING_APPROVE", displayName: "Approve Pricing", description: "Procurement head approves final price." },
];

export async function ensureDefaultWorkflow(): Promise<typeof procurementWorkflowsTable.$inferSelect> {
  // Try ANY workflow first; if none, seed the canonical default.
  const existing = await db.select().from(procurementWorkflowsTable);
  if (existing.length > 0) {
    const def = existing.find((w) => w.isDefault && w.isActive && w.commodityType == null);
    if (def) return def;
    return existing[0]!;
  }
  return await db.transaction(async (tx) => {
    const [wf] = await tx
      .insert(procurementWorkflowsTable)
      .values({
        code: "DEFAULT",
        name: "Default Procurement Workflow",
        description: "Canonical 6-stage flow: weight, QC, pricing — each gated by submitter + approver.",
        commodityType: null,
        isActive: true,
        isDefault: true,
      })
      .returning();
    await tx.insert(procurementWorkflowStagesTable).values(
      DEFAULT_STAGES.map((s, i) => ({
        workflowId: wf!.id,
        stageKind: s.stageKind,
        orderIdx: i,
        displayName: s.displayName,
        description: s.description,
        requiredPermission: null,
        slaHours: null,
        isActive: true,
        isOptional: false,
      })),
    );
    return wf!;
  });
}

// Resolve a workflow for a delivery: commodity-specific active default first, then global default.
export async function resolveWorkflowForDelivery(commodityType: string | null | undefined) {
  await ensureDefaultWorkflow();
  const all = await db
    .select()
    .from(procurementWorkflowsTable)
    .where(eq(procurementWorkflowsTable.isActive, true));
  if (commodityType) {
    const cs = all.find((w) => w.commodityType === commodityType && w.isDefault) ?? all.find((w) => w.commodityType === commodityType);
    if (cs) return cs;
  }
  return all.find((w) => w.commodityType == null && w.isDefault) ?? all.find((w) => w.commodityType == null) ?? all[0]!;
}

export async function getWorkflowStages(workflowId: string) {
  return await db
    .select()
    .from(procurementWorkflowStagesTable)
    .where(eq(procurementWorkflowStagesTable.workflowId, workflowId))
    .orderBy(asc(procurementWorkflowStagesTable.orderIdx));
}

async function workflowDetail(workflowId: string) {
  const [wf] = await db.select().from(procurementWorkflowsTable).where(eq(procurementWorkflowsTable.id, workflowId));
  if (!wf) return null;
  const stages = await getWorkflowStages(workflowId);
  return { ...wf, stageCount: stages.length, stages };
}

async function workflowList() {
  const wfs = await db.select().from(procurementWorkflowsTable);
  const allStages = await db.select().from(procurementWorkflowStagesTable);
  return wfs.map((w) => ({ ...w, stageCount: allStages.filter((s) => s.workflowId === w.id).length }));
}

async function audit(action: string, workflowId: string, user: AuthedRequest["authedUser"], payload: Record<string, unknown>) {
  await db.insert(auditLogsTable).values({
    entityType: "procurement_workflow",
    entityId: workflowId,
    action,
    actorId: user?.id ?? "system",
    actorName: user?.email ?? "system",
    actorRole: user?.role ?? "system",
    after: payload,
  });
}

router.get("/procurement/workflows", requirePermission("procurement.read"), async (_req, res): Promise<void> => {
  await ensureDefaultWorkflow();
  res.json(await workflowList());
});

router.post("/procurement/workflows", requirePermission("admin.workflows.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateProcurementWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { code, name, description, commodityType, isDefault, stages } = parsed.data;
  // stages array on the body is optional but if present must reference valid stageKinds and have non-empty displayName.
  if (stages) {
    for (const s of stages) {
      if (!STAGE_KINDS.includes(s.stageKind as any)) {
        res.status(400).json({ error: `Invalid stageKind ${s.stageKind}` }); return;
      }
    }
  }
  try {
    const result = await db.transaction(async (tx) => {
      // If isDefault is true, demote any existing default for the same commodity bucket so there's
      // always exactly one default (NULL or matching commodityType).
      if (isDefault) {
        const peers = await tx.select().from(procurementWorkflowsTable);
        const sameBucket = peers.filter((p) => (p.commodityType ?? null) === (commodityType ?? null));
        for (const p of sameBucket) {
          if (p.isDefault) await tx.update(procurementWorkflowsTable).set({ isDefault: false }).where(eq(procurementWorkflowsTable.id, p.id));
        }
      }
      const [wf] = await tx
        .insert(procurementWorkflowsTable)
        .values({
          code,
          name,
          description: description ?? null,
          commodityType: commodityType ?? null,
          isActive: true,
          isDefault: isDefault ?? false,
          createdById: req.authedUser?.id ?? null,
        })
        .returning();
      if (stages && stages.length > 0) {
        await tx.insert(procurementWorkflowStagesTable).values(
          stages.map((s, i) => ({
            workflowId: wf!.id,
            stageKind: s.stageKind,
            orderIdx: i,
            displayName: s.displayName,
            description: s.description ?? null,
            requiredPermission: s.requiredPermission ?? null,
            slaHours: s.slaHours ?? null,
            isActive: true,
            isOptional: s.isOptional ?? false,
          })),
        );
      }
      return wf!.id;
    });
    await audit("workflow.create", result, req.authedUser, { code, name, stageCount: stages?.length ?? 0 });
    res.status(201).json(await workflowDetail(result));
  } catch (e: any) {
    if (e?.code === "23505") { res.status(409).json({ error: `Workflow code '${code}' already exists` }); return; }
    throw e;
  }
});

router.get("/procurement/workflows/:workflowId", requirePermission("procurement.read"), async (req, res): Promise<void> => {
  const detail = await workflowDetail(req.params.workflowId as string);
  if (!detail) { res.status(404).json({ error: "Workflow not found" }); return; }
  res.json(detail);
});

router.patch("/procurement/workflows/:workflowId", requirePermission("admin.workflows.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = UpdateProcurementWorkflowBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const id = req.params.workflowId as string;
  const [existing] = await db.select().from(procurementWorkflowsTable).where(eq(procurementWorkflowsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Workflow not found" }); return; }
  const d = parsed.data;
  await db.transaction(async (tx) => {
    if (d.isDefault === true) {
      const bucketCommodity = d.commodityType !== undefined ? d.commodityType : existing.commodityType;
      const peers = await tx.select().from(procurementWorkflowsTable);
      for (const p of peers) {
        if (p.id !== id && (p.commodityType ?? null) === (bucketCommodity ?? null) && p.isDefault) {
          await tx.update(procurementWorkflowsTable).set({ isDefault: false }).where(eq(procurementWorkflowsTable.id, p.id));
        }
      }
    }
    const updates: any = { updatedAt: new Date() };
    if (d.name !== undefined) updates.name = d.name;
    if (d.description !== undefined) updates.description = d.description;
    if (d.commodityType !== undefined) updates.commodityType = d.commodityType;
    if (d.isActive !== undefined) updates.isActive = d.isActive;
    if (d.isDefault !== undefined) updates.isDefault = d.isDefault;
    await tx.update(procurementWorkflowsTable).set(updates).where(eq(procurementWorkflowsTable.id, id));
  });
  await audit("workflow.update", id, req.authedUser, d);
  res.json(await workflowDetail(id));
});

router.post("/procurement/workflows/:workflowId/stages", requirePermission("admin.workflows.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = AddWorkflowStageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const id = req.params.workflowId as string;
  const [wf] = await db.select().from(procurementWorkflowsTable).where(eq(procurementWorkflowsTable.id, id));
  if (!wf) { res.status(404).json({ error: "Workflow not found" }); return; }
  if (!STAGE_KINDS.includes(parsed.data.stageKind as any)) { res.status(400).json({ error: "Invalid stageKind" }); return; }
  const stages = await getWorkflowStages(id);
  await db.insert(procurementWorkflowStagesTable).values({
    workflowId: id,
    stageKind: parsed.data.stageKind,
    orderIdx: stages.length,
    displayName: parsed.data.displayName,
    description: parsed.data.description ?? null,
    requiredPermission: parsed.data.requiredPermission ?? null,
    slaHours: parsed.data.slaHours ?? null,
    isActive: true,
    isOptional: parsed.data.isOptional ?? false,
  });
  await audit("workflow.stage.add", id, req.authedUser, parsed.data);
  res.status(201).json(await workflowDetail(id));
});

router.patch("/procurement/workflows/:workflowId/stages/:stageId", requirePermission("admin.workflows.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = UpdateWorkflowStageBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { workflowId, stageId } = req.params;
  const [stage] = await db
    .select()
    .from(procurementWorkflowStagesTable)
    .where(and(eq(procurementWorkflowStagesTable.id, stageId as string), eq(procurementWorkflowStagesTable.workflowId, workflowId as string)));
  if (!stage) { res.status(404).json({ error: "Stage not found" }); return; }
  const d = parsed.data;
  const updates: any = { updatedAt: new Date() };
  if (d.displayName !== undefined) updates.displayName = d.displayName;
  if (d.description !== undefined) updates.description = d.description;
  if (d.requiredPermission !== undefined) updates.requiredPermission = d.requiredPermission;
  if (d.slaHours !== undefined) updates.slaHours = d.slaHours;
  if (d.isActive !== undefined) updates.isActive = d.isActive;
  if (d.isOptional !== undefined) updates.isOptional = d.isOptional;
  await db.update(procurementWorkflowStagesTable).set(updates).where(eq(procurementWorkflowStagesTable.id, stageId as string));
  await audit("workflow.stage.update", workflowId as string, req.authedUser, { stageId, ...d });
  res.json(await workflowDetail(workflowId as string));
});

router.delete("/procurement/workflows/:workflowId/stages/:stageId", requirePermission("admin.workflows.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { workflowId, stageId } = req.params;
  const stages = await getWorkflowStages(workflowId as string);
  const target = stages.find((s) => s.id === stageId);
  if (!target) { res.status(404).json({ error: "Stage not found" }); return; }
  await db.transaction(async (tx) => {
    await tx.delete(procurementWorkflowStagesTable).where(eq(procurementWorkflowStagesTable.id, stageId as string));
    // Compact orderIdx so the sequence stays gap-free (engine relies on currentStageOrder).
    // Two-pass shift: bump every later row to a high temp index, then back down — avoids unique-index collisions.
    const remaining = stages.filter((s) => s.id !== stageId).sort((a, b) => a.orderIdx - b.orderIdx);
    const TEMP_OFFSET = 10000;
    for (const s of remaining) {
      await tx.update(procurementWorkflowStagesTable).set({ orderIdx: s.orderIdx + TEMP_OFFSET }).where(eq(procurementWorkflowStagesTable.id, s.id));
    }
    for (let i = 0; i < remaining.length; i++) {
      await tx.update(procurementWorkflowStagesTable).set({ orderIdx: i }).where(eq(procurementWorkflowStagesTable.id, remaining[i]!.id));
    }
  });
  await audit("workflow.stage.delete", workflowId as string, req.authedUser, { stageId, deletedKind: target.stageKind });
  res.json(await workflowDetail(workflowId as string));
});

router.post("/procurement/workflows/:workflowId/stages/reorder", requirePermission("admin.workflows.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ReorderWorkflowStagesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { workflowId } = req.params;
  const stages = await getWorkflowStages(workflowId as string);
  const ids = parsed.data.stageIds;
  // Strict set equality: same length, no duplicates, every id belongs to this workflow.
  const idSet = new Set(ids);
  const existingIds = new Set(stages.map((s) => s.id));
  if (
    ids.length !== stages.length ||
    idSet.size !== ids.length ||
    !ids.every((id) => existingIds.has(id))
  ) {
    res.status(400).json({ error: "stageIds must be a permutation of the workflow's existing stage ids (no duplicates, no extras, no omissions)" });
    return;
  }
  // Two-pass to bypass the (workflowId, orderIdx) unique index.
  const TEMP_OFFSET = 10000;
  await db.transaction(async (tx) => {
    for (const s of stages) {
      await tx.update(procurementWorkflowStagesTable).set({ orderIdx: s.orderIdx + TEMP_OFFSET }).where(eq(procurementWorkflowStagesTable.id, s.id));
    }
    for (let i = 0; i < ids.length; i++) {
      await tx.update(procurementWorkflowStagesTable).set({ orderIdx: i, updatedAt: new Date() }).where(eq(procurementWorkflowStagesTable.id, ids[i]!));
    }
  });
  await audit("workflow.stages.reorder", workflowId as string, req.authedUser, { stageIds: ids });
  res.json(await workflowDetail(workflowId as string));
});

export default router;
