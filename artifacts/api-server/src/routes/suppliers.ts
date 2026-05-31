import { Router, type IRouter } from "express";
import { eq, and, desc, ilike, or } from "drizzle-orm";
import { z } from "zod/v4";
import { db, suppliersTable, auditLogsTable } from "@workspace/db";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";

const router: IRouter = Router();

// Inline request schemas. The Orval-generated zod names for the suppliers tag
// collide oddly, so — as loan-catalog.ts does — we validate with local schemas.
const sellerTypeSchema = z.enum(["business", "individual"]);
const paymentMethodSchema = z.enum(["cash", "mobile_money", "bank_transfer"]);
const momoProviderSchema = z.enum(["mtn_momo", "airtel_money"]);
const statusSchema = z.enum(["pending", "active", "inactive"]);

const CreateSupplierBody = z.object({
  sellerType: sellerTypeSchema,
  businessName: z.string().max(200).optional().nullable(),
  businessRegNo: z.string().max(100).optional().nullable(),
  firstName: z.string().max(120).optional().nullable(),
  lastName: z.string().max(120).optional().nullable(),
  nationalId: z.string().max(60).optional().nullable(),
  phoneNumber: z.string().max(30).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
  regionId: z.string().uuid().optional().nullable(),
  village: z.string().max(160).optional().nullable(),
  address: z.string().max(400).optional().nullable(),
  paymentMethod: paymentMethodSchema.optional().nullable(),
  momoProvider: momoProviderSchema.optional().nullable(),
  momoMsisdn: z.string().max(20).optional().nullable(),
  bankName: z.string().max(160).optional().nullable(),
  bankAccountNumber: z.string().max(60).optional().nullable(),
  status: statusSchema.optional().nullable(),
  loanEligible: z.boolean().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});
const UpdateSupplierBody = CreateSupplierBody.partial();

function generateSupplierRef(): string {
  return "SUP-" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

// Validate the seller-type-specific required fields. Businesses need a trading
// name; individuals need a name + national id. Keeps junk rows out regardless
// of what the client form enforces.
function validateSellerFields(d: {
  sellerType?: string | null;
  businessName?: string | null;
  firstName?: string | null;
  nationalId?: string | null;
}): string | null {
  if (d.sellerType === "business") {
    if (!d.businessName || !d.businessName.trim()) return "businessName is required for a business supplier";
  } else if (d.sellerType === "individual") {
    if (!d.firstName || !d.firstName.trim()) return "firstName is required for an individual supplier";
    if (!d.nationalId || !d.nationalId.trim()) return "nationalId is required for an individual supplier";
  } else {
    return "sellerType must be 'business' or 'individual'";
  }
  return null;
}

router.get("/suppliers", requirePermission("suppliers.read"), async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const sellerType = typeof req.query.sellerType === "string" ? req.query.sellerType : "";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conditions: any[] = [];
  if (sellerType === "business" || sellerType === "individual") conditions.push(eq(suppliersTable.sellerType, sellerType));
  if (status === "pending" || status === "active" || status === "inactive") conditions.push(eq(suppliersTable.status, status));
  if (search) {
    conditions.push(or(
      ilike(suppliersTable.businessName, `%${search}%`),
      ilike(suppliersTable.firstName, `%${search}%`),
      ilike(suppliersTable.lastName, `%${search}%`),
      ilike(suppliersTable.referenceNumber, `%${search}%`),
      ilike(suppliersTable.nationalId, `%${search}%`),
      ilike(suppliersTable.businessRegNo, `%${search}%`),
    ));
  }
  const rows = conditions.length
    ? await db.select().from(suppliersTable).where(and(...conditions)).orderBy(desc(suppliersTable.createdAt))
    : await db.select().from(suppliersTable).orderBy(desc(suppliersTable.createdAt));
  res.json(rows);
});

router.post("/suppliers", requirePermission("suppliers.write"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateSupplierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;
  const fieldErr = validateSellerFields(d);
  if (fieldErr) { res.status(400).json({ error: fieldErr }); return; }

  const referenceNumber = generateSupplierRef();
  try {
    const row = await db.transaction(async (tx) => {
      const [supplier] = await tx.insert(suppliersTable).values({
        referenceNumber,
        sellerType: d.sellerType,
        businessName: d.businessName ?? null,
        businessRegNo: d.businessRegNo ?? null,
        firstName: d.firstName ?? null,
        lastName: d.lastName ?? null,
        nationalId: d.nationalId ?? null,
        phoneNumber: d.phoneNumber ?? null,
        email: d.email ?? null,
        regionId: d.regionId ?? null,
        village: d.village ?? null,
        address: d.address ?? null,
        paymentMethod: d.paymentMethod ?? null,
        momoProvider: d.momoProvider ?? null,
        momoMsisdn: d.momoMsisdn ?? null,
        bankName: d.bankName ?? null,
        bankAccountNumber: d.bankAccountNumber ?? null,
        status: d.status ?? "pending",
        loanEligible: d.loanEligible ?? false,
        notes: d.notes ?? null,
      }).returning();
      await tx.insert(auditLogsTable).values({
        entityType: "supplier",
        entityId: supplier.id,
        action: "supplier.create",
        actorId: req.authedUser?.id ?? "system",
        actorName: req.authedUser?.email ?? "system",
        actorRole: req.authedUser?.role ?? "system",
        after: { referenceNumber, sellerType: d.sellerType },
      });
      return supplier;
    });
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "A supplier with that national ID or business registration number already exists" });
      return;
    }
    throw e;
  }
});

router.get("/suppliers/:supplierId", requirePermission("suppliers.read"), async (req, res): Promise<void> => {
  const { supplierId } = req.params;
  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplierId as string));
  if (!supplier) { res.status(404).json({ error: "Supplier not found" }); return; }
  res.json(supplier);
});

router.patch("/suppliers/:supplierId", requirePermission("suppliers.write"), async (req: AuthedRequest, res): Promise<void> => {
  const { supplierId } = req.params;
  const parsed = UpdateSupplierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body", details: parsed.error.issues }); return; }
  const d = parsed.data;

  const [existing] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplierId as string));
  if (!existing) { res.status(404).json({ error: "Supplier not found" }); return; }

  // Validate the merged record against the seller-type invariants.
  const fieldErr = validateSellerFields({
    sellerType: d.sellerType ?? existing.sellerType,
    businessName: d.businessName !== undefined ? d.businessName : existing.businessName,
    firstName: d.firstName !== undefined ? d.firstName : existing.firstName,
    nationalId: d.nationalId !== undefined ? d.nationalId : existing.nationalId,
  });
  if (fieldErr) { res.status(400).json({ error: fieldErr }); return; }

  const update: Record<string, unknown> = { updatedAt: new Date() };
  const fields = [
    "sellerType", "businessName", "businessRegNo", "firstName", "lastName", "nationalId",
    "phoneNumber", "email", "regionId", "village", "address", "paymentMethod", "momoProvider",
    "momoMsisdn", "bankName", "bankAccountNumber", "status", "loanEligible", "notes",
  ] as const;
  for (const f of fields) {
    const v = (d as Record<string, unknown>)[f];
    if (v === undefined) continue;
    // status and loanEligible are NOT NULL — ignore explicit nulls for them.
    if ((f === "status" || f === "loanEligible") && v === null) continue;
    update[f] = v;
  }
  try {
    const [supplier] = await db.update(suppliersTable).set(update).where(eq(suppliersTable.id, supplierId as string)).returning();
    await db.insert(auditLogsTable).values({
      entityType: "supplier",
      entityId: supplierId as string,
      action: "supplier.update",
      actorId: req.authedUser?.id ?? "system",
      actorName: req.authedUser?.email ?? "system",
      actorRole: req.authedUser?.role ?? "system",
      before: { status: existing.status, loanEligible: existing.loanEligible },
      after: { status: supplier.status, loanEligible: supplier.loanEligible },
    });
    res.json(supplier);
  } catch (e: any) {
    if (e?.code === "23505") {
      res.status(409).json({ error: "A supplier with that national ID or business registration number already exists" });
      return;
    }
    throw e;
  }
});

export default router;
