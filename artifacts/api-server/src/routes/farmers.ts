import { Router, type IRouter } from "express";
import { eq, ilike, or, and, desc, sql, inArray } from "drizzle-orm";
import { db, farmersTable, groupsTable, plotsTable, certificationEnrolmentsTable, certificationStreamsTable, surveySubmissionsTable, gapAssessmentsTable, auditLogsTable, usersTable, userGroupsTable, farmerCropsTable, commoditiesTable } from "@workspace/db";
import {
  CreateFarmerBody,
  UpdateFarmerBody,
  ListFarmersQueryParams,
} from "@workspace/api-zod";
import { requirePermission, type AuthedRequest } from "../middlewares/auth";
import { checkFarmerAccess, isUserScoped, getAssignedGroupIds } from "../lib/assignment-scope";
import { isLeafInsideOrgRegion, isLeafRegion, isGroupInsideOrgRegion, getGroupDistrictIds, getDistrictAncestorId } from "../lib/org-region-scope";

/**
 * Multi-district invariant: when a farmer is being created against a group,
 * the farmer's village must roll up into one of the group's covered districts.
 * Returns a 400-shaped error or null if all is well.
 */
async function ensureFarmerDistrictInGroup(
  groupId: string,
  farmerRegionId: string,
): Promise<{ error: string; code: string } | null> {
  const [farmerDistrict, groupDistricts] = await Promise.all([
    getDistrictAncestorId(farmerRegionId),
    getGroupDistrictIds(groupId),
  ]);
  if (!farmerDistrict || !groupDistricts.has(farmerDistrict)) {
    return {
      error: "Selected village is not in any district covered by this group",
      code: "FARMER_DISTRICT_NOT_IN_GROUP",
    };
  }
  return null;
}
import { getActiveTemplate, computeStageFromTemplate, type RegistrationStage } from "../lib/registration-stage";
import {
  parseCustomFieldValues,
  replaceFarmerCustomFieldValues,
  loadFarmerCustomFieldValues,
} from "../lib/custom-field-values";

const router: IRouter = Router();

function generateRefNumber(): string {
  return "F" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
}

// ---------- Farm + livelihood patch builder (shared by /farmers and /complete) ----------
// Pulls the optional livelihood + activities fields off req.body. We accept loose
// types and clamp/strip — these are mobile-form inputs and we don't want a typo on a
// fuel-type chip to fail the whole registration. Returns only the fields actually present.
const ACTIVITY_CHIPS = new Set(["livestock", "fishing", "beekeeping", "trading", "carpentry", "other"]);
const INCOME_SOURCES = new Set(["none", "trading", "wage_labour", "remittance", "other"]);
const EDUCATION_LEVELS = new Set(["none", "primary", "secondary", "tertiary"]);
const COOKING_FUELS = new Set(["firewood", "charcoal", "lpg", "electricity", "other"]);

function pickLivelihoodPatch(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  // otherActivities[] — accept any array of strings, lowercase + filter to known chips.
  if (Array.isArray(body.otherActivities)) {
    const cleaned = (body.otherActivities as unknown[])
      .filter((v): v is string => typeof v === "string")
      .map(v => v.trim().toLowerCase())
      .filter(v => ACTIVITY_CHIPS.has(v));
    patch.otherActivities = Array.from(new Set(cleaned));
  }
  // numerics — accept number; numeric() column wants a string for Drizzle.
  if (typeof body.cultivatedLandHa === "number" && body.cultivatedLandHa >= 0) {
    patch.cultivatedLandHa = String(body.cultivatedLandHa);
  }
  if (typeof body.offFarmIncomeSource === "string" && INCOME_SOURCES.has(body.offFarmIncomeSource)) {
    patch.offFarmIncomeSource = body.offFarmIncomeSource;
  }
  if (typeof body.offFarmIncomeMonthlyUgx === "number" && body.offFarmIncomeMonthlyUgx >= 0) {
    patch.offFarmIncomeMonthlyUgx = Math.round(body.offFarmIncomeMonthlyUgx);
  }
  if (typeof body.monthsOfFoodShortage === "number" && body.monthsOfFoodShortage >= 0 && body.monthsOfFoodShortage <= 12) {
    patch.monthsOfFoodShortage = Math.round(body.monthsOfFoodShortage);
  }
  if (typeof body.educationLevelHead === "string" && EDUCATION_LEVELS.has(body.educationLevelHead)) {
    patch.educationLevelHead = body.educationLevelHead;
  }
  if (typeof body.accessCleanWater === "boolean") patch.accessCleanWater = body.accessCleanWater;
  if (typeof body.accessElectricity === "boolean") patch.accessElectricity = body.accessElectricity;
  if (typeof body.primaryCookingFuel === "string" && COOKING_FUELS.has(body.primaryCookingFuel)) {
    patch.primaryCookingFuel = body.primaryCookingFuel;
  }
  return patch;
}

// Parse + sanitize crops[] from the body. Returns either a clean array of crop rows or an
// error string. Empty input returns []. lastHarvestKg/Date are optional per row.
type ParsedCrop = { commodityId: string; lastHarvestKg: string | null; lastHarvestDate: string | null };
function parseCropsInput(body: Record<string, unknown>): ParsedCrop[] | { error: string } {
  if (body.crops === undefined || body.crops === null) return [];
  if (!Array.isArray(body.crops)) return { error: "crops must be an array" };
  const out: ParsedCrop[] = [];
  for (const raw of body.crops as unknown[]) {
    if (!raw || typeof raw !== "object") return { error: "each crop must be an object" };
    const c = raw as Record<string, unknown>;
    const commodityId = typeof c.commodityId === "string" ? c.commodityId.trim() : "";
    if (!commodityId) return { error: "crops[].commodityId is required" };
    const kg = (typeof c.lastHarvestKg === "number" && c.lastHarvestKg >= 0) ? String(c.lastHarvestKg) : null;
    const date = (typeof c.lastHarvestDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.lastHarvestDate)) ? c.lastHarvestDate : null;
    out.push({ commodityId, lastHarvestKg: kg, lastHarvestDate: date });
  }
  // Dedupe by commodityId — the unique index would reject duplicates anyway.
  const seen = new Set<string>();
  return out.filter(c => seen.has(c.commodityId) ? false : (seen.add(c.commodityId), true));
}

// Validates that every commodityId exists. Returns null on success or an error string.
async function validateCommodityIds(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const found = await db.select({ id: commoditiesTable.id }).from(commoditiesTable).where(inArray(commoditiesTable.id, ids));
  if (found.length !== ids.length) {
    const foundSet = new Set(found.map(r => r.id));
    const missing = ids.filter(id => !foundSet.has(id));
    return `Unknown commodityId(s): ${missing.join(", ")}`;
  }
  return null;
}

async function buildFarmerResponse(farmer: any) {
  const group = farmer.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, farmer.groupId)).limit(1)
    : [];
  return {
    ...farmer,
    groupName: group[0]?.name ?? null,
    areaHectares: 0,
  };
}

router.get("/farmers", async (req: AuthedRequest, res): Promise<void> => {
  const parsed = ListFarmersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { search, groupId, regionId, status, page = 1, limit = 50 } = parsed.data;
  // registrationStage filter is read directly off req.query because it's not in the
  // (codegen'd) ListFarmersQueryParams schema yet. Whitelist the two valid values
  // so callers can't smuggle arbitrary SQL fragments in.
  const stageRaw = typeof req.query.registrationStage === "string" ? req.query.registrationStage : "";
  // Accept comma-separated stages so completion UIs can fetch both
  // pre_registered AND partially_registered in one call.
  const allowedStages = new Set(["pre_registered", "partially_registered", "fully_registered"]);
  const stageList = stageRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => allowedStages.has(s)) as Array<"pre_registered" | "partially_registered" | "fully_registered">;
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(farmersTable.firstName, `%${search}%`),
        ilike(farmersTable.lastName, `%${search}%`),
        ilike(farmersTable.nationalId, `%${search}%`),
        ilike(farmersTable.referenceNumber, `%${search}%`)
      )
    );
  }
  if (groupId) conditions.push(eq(farmersTable.groupId, groupId));
  if (regionId) conditions.push(eq(farmersTable.regionId, regionId));
  if (status) conditions.push(eq(farmersTable.status, status));
  if (stageList.length === 1) {
    conditions.push(eq(farmersTable.registrationStage, stageList[0]));
  } else if (stageList.length > 1) {
    conditions.push(inArray(farmersTable.registrationStage, stageList));
  }

  // Per-user assignment scoping: if the requester has `groups.assigned_only`
  // (and isn't a wildcard admin), restrict farmers to those whose groupId is
  // in user_groups for this user. With zero assignments → returns empty.
  const perms = req.authedUser?.permissions ?? [];
  const scoped = perms.includes("groups.assigned_only") && !perms.includes("*");
  if (scoped) {
    const assigned = await db
      .select({ groupId: userGroupsTable.groupId })
      .from(userGroupsTable)
      .where(eq(userGroupsTable.userId, req.authedUser!.id));
    const ids = assigned.map(a => a.groupId);
    if (ids.length === 0) {
      res.json({ data: [], total: 0, page, limit });
      return;
    }
    conditions.push(inArray(farmersTable.groupId, ids));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [farmers, countResult] = await Promise.all([
    db.select().from(farmersTable).where(whereClause).orderBy(desc(farmersTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(farmersTable).where(whereClause),
  ]);

  const groupIds = [...new Set(farmers.map(f => f.groupId).filter(Boolean))];
  const groups = groupIds.length > 0
    ? await db.select().from(groupsTable).where(sql`${groupsTable.id} = ANY(ARRAY[${sql.join(groupIds.map(id => sql`${id}::uuid`), sql`, `)}])`)
    : [];
  const groupMap = Object.fromEntries(groups.map(g => [g.id, g.name]));

  const data = farmers.map(f => ({ ...f, groupName: groupMap[f.groupId] ?? null }));

  res.json({ data, total: countResult[0]?.count ?? 0, page, limit });
});

// ---------- POST /farmers (full registration) ----------
// Requires `farmers.register`. Sets registrationStage='fully_registered'. National ID is
// expected for full registration (the existing CreateFarmerBody schema enforces required
// fields). For lighter capture, agents use POST /farmers/preregister below.
router.post("/farmers", requirePermission("farmers.register"), async (req: AuthedRequest, res): Promise<void> => {
  const parsed = CreateFarmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Mandatory group membership (MTANDEO policy): every farmer must belong to an ACTIVE group.
  const rawGroupId: unknown = (parsed.data as any).groupId ?? (req.body as any).groupId;
  if (typeof rawGroupId !== "string" || !rawGroupId) {
    res.status(400).json({ error: "groupId is required — farmers must belong to a group", code: "GROUP_REQUIRED" });
    return;
  }
  const groupId: string = rawGroupId;
  // Per-user assignment scoping: scoped users may only register farmers into groups
  // they are explicitly assigned to.
  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    if (!assigned.has(groupId)) {
      res.status(403).json({ error: "You are not assigned to this group" });
      return;
    }
  }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(400).json({ error: "Group not found", code: "GROUP_NOT_FOUND" }); return; }
  if (group.status === "archived") {
    res.status(400).json({ error: "Cannot register farmer into an archived group", code: "GROUP_ARCHIVED" });
    return;
  }
  // Org Region binding (mobile 3-dropdown flow). Mirrors the checks applied on
  // /preregister so the one-shot full-register entry point on mobile gets the
  // same containment guarantees. Back-compat: when orgRegionId is absent the
  // existing web full-register path is unaffected.
  const orgRegionIdRaw = (req.body as any)?.orgRegionId;
  const orgRegionId = typeof orgRegionIdRaw === "string" ? orgRegionIdRaw.trim() : "";
  if (orgRegionId) {
    const farmerRegionId = (parsed.data as any).regionId as string | undefined;
    if (!farmerRegionId) {
      res.status(400).json({ error: "regionId is required when orgRegionId is supplied", code: "REGION_REQUIRED" });
      return;
    }
    const isLeaf = await isLeafRegion(farmerRegionId);
    if (!isLeaf) {
      res.status(400).json({ error: "Selected village must be at the deepest admin level", code: "REGION_NOT_LEAF" });
      return;
    }
    const villageOk = await isLeafInsideOrgRegion(farmerRegionId, orgRegionId);
    if (!villageOk) {
      res.status(400).json({ error: "Selected village is not inside the chosen region", code: "VILLAGE_OUT_OF_ORG_REGION" });
      return;
    }
    const groupVillageOk = await isGroupInsideOrgRegion(group.id, orgRegionId);
    if (!groupVillageOk) {
      res.status(400).json({ error: "Selected group is not inside the chosen region", code: "GROUP_OUT_OF_ORG_REGION" });
      return;
    }
    const inGroupDistricts = await ensureFarmerDistrictInGroup(group.id, farmerRegionId);
    if (inGroupDistricts) { res.status(400).json(inGroupDistricts); return; }
  }
  // Optional farm + livelihood capture (mobile full-register form)
  const livelihoodPatch = pickLivelihoodPatch(req.body as Record<string, unknown>);
  const cropsParsed = parseCropsInput(req.body as Record<string, unknown>);
  if (!Array.isArray(cropsParsed)) {
    res.status(400).json({ error: cropsParsed.error });
    return;
  }
  const cropCommodityIds = cropsParsed.map(c => c.commodityId);
  const commodityErr = await validateCommodityIds(cropCommodityIds);
  if (commodityErr) { res.status(400).json({ error: commodityErr, code: "UNKNOWN_COMMODITY" }); return; }

  const referenceNumber = generateRefNumber();
  const now = new Date();
  // Compute stage from the active template. If no template is published, keep the
  // legacy behaviour: a successful POST /api/farmers (which Zod-validates the
  // bedrock fields) lands as "fully_registered". When a template IS active the
  // computed result wins — a "partially_registered" first registration is allowed
  // (the form gathers what it can; mandatory misses just downgrade the stage).
  // App is Uganda-localized — prefer the UG template, falling back to global
  // automatically inside getActiveTemplate when no UG template exists.
  const tpl = await getActiveTemplate("UG");
  // Custom field values (validated against the active template's custom field
  // catalog). Without a template, custom values are silently dropped so legacy
  // tenants don't get rejected.
  const customParse = parseCustomFieldValues(req.body, tpl?.fields ?? []);
  if ("error" in customParse) {
    res.status(400).json({ error: customParse.error });
    return;
  }
  const customValues = customParse.values;
  const mergedForStage: Record<string, unknown> = { ...parsed.data, ...livelihoodPatch };
  const computedStage: RegistrationStage = tpl
    ? (computeStageFromTemplate(tpl.fields, mergedForStage, customValues, cropsParsed.length) ?? "fully_registered")
    : "fully_registered";
  // Transaction so the farmer + crops + custom values insert atomically. If
  // any sub-insert fails the whole farmer creation is rolled back.
  const farmer = await db.transaction(async (tx) => {
    const [created] = await tx.insert(farmersTable).values({
      ...parsed.data,
      ...livelihoodPatch,
      referenceNumber,
      registrationStage: computedStage,
      fullyRegisteredAt: computedStage === "fully_registered" ? now : null,
      preRegisteredAt: now, // For audit symmetry — full registration always passes through "pre" implicitly.
      status: computedStage === "fully_registered" ? "active" : "pending",
    }).returning();
    if (cropsParsed.length > 0) {
      await tx.insert(farmerCropsTable).values(cropsParsed.map(c => ({
        farmerId: created.id,
        commodityId: c.commodityId,
        lastHarvestKg: c.lastHarvestKg,
        lastHarvestDate: c.lastHarvestDate,
      })));
    }
    await replaceFarmerCustomFieldValues(tx, created.id, customValues);
    return created;
  });
  const result = await buildFarmerResponse(farmer);
  res.status(201).json(result);
});

// ---------- POST /farmers/preregister (light capture) ----------
// Captures the bare minimum to identify a farmer in the field — name, group, region, and
// optionally phone/village. National ID and other KYC fields can be added later via
// /farmers/:farmerId/complete. Status is set to 'pending' so admin/full registration is
// required before the farmer is treated as active.
router.post("/farmers/preregister", requirePermission("farmers.preregister"), async (req: AuthedRequest, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const groupId = typeof body.groupId === "string" ? body.groupId : "";
  const regionId = typeof body.regionId === "string" ? body.regionId : "";
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const village = typeof body.village === "string" ? body.village.trim() : "";
  const sex = typeof body.sex === "string" ? body.sex : "";
  const orgRegionId = typeof body.orgRegionId === "string" ? body.orgRegionId.trim() : "";

  const fieldErrors: Record<string, string> = {};
  if (!firstName) fieldErrors.firstName = "Required";
  if (!lastName) fieldErrors.lastName = "Required";
  if (!groupId) fieldErrors.groupId = "Required";
  if (!regionId) fieldErrors.regionId = "Required";
  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({ error: "Missing required fields", fieldErrors });
    return;
  }
  // Org Region binding (mobile 3-dropdown flow). When supplied, enforce that:
  //   1. regionId is a true leaf (village) - prevents passing an ancestor that
  //      would coincidentally pass the "inside org region" check.
  //   2. The picked village's ancestor district is in the org region.
  //   3. The picked group's anchor village ancestor district is in the org region.
  // Forms that don't yet send orgRegionId continue to work for back-compat;
  // the web back-office still uses the cascading region picker without it.
  if (orgRegionId) {
    const [grp] = await db
      .select({ id: groupsTable.id, regionId: groupsTable.regionId })
      .from(groupsTable)
      .where(eq(groupsTable.id, groupId));
    if (!grp) { res.status(400).json({ error: "Group not found", code: "GROUP_NOT_FOUND" }); return; }
    const isLeaf = await isLeafRegion(regionId);
    if (!isLeaf) {
      res.status(400).json({ error: "Selected village must be at the deepest admin level", code: "REGION_NOT_LEAF" });
      return;
    }
    const villageOk = await isLeafInsideOrgRegion(regionId, orgRegionId);
    if (!villageOk) {
      res.status(400).json({ error: "Selected village is not inside the chosen region", code: "VILLAGE_OUT_OF_ORG_REGION" });
      return;
    }
    const groupVillageOk = await isGroupInsideOrgRegion(grp.id, orgRegionId);
    if (!groupVillageOk) {
      res.status(400).json({ error: "Selected group is not inside the chosen region", code: "GROUP_OUT_OF_ORG_REGION" });
      return;
    }
    const inGroupDistricts = await ensureFarmerDistrictInGroup(grp.id, regionId);
    if (inGroupDistricts) { res.status(400).json(inGroupDistricts); return; }
  }
  // Per-user assignment scoping: field staff with `groups.assigned_only` may only
  // pre-register into groups they are assigned to.
  if (isUserScoped(req.authedUser)) {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    if (!assigned.has(groupId)) {
      res.status(403).json({ error: "You are not assigned to this group" });
      return;
    }
  }
  const [group] = await db.select().from(groupsTable).where(eq(groupsTable.id, groupId));
  if (!group) { res.status(400).json({ error: "Group not found", code: "GROUP_NOT_FOUND" }); return; }
  if (group.status === "archived") {
    res.status(400).json({ error: "Cannot pre-register into an archived group", code: "GROUP_ARCHIVED" });
    return;
  }
  const referenceNumber = generateRefNumber();
  const now = new Date();
  const [farmer] = await db.insert(farmersTable).values({
    firstName,
    lastName,
    groupId,
    regionId,
    phoneNumber: phoneNumber || null,
    village: village || null,
    sex: sex || null,
    status: "pending",
    registrationStage: "pre_registered",
    preRegisteredAt: now,
    referenceNumber,
  }).returning();
  const result = await buildFarmerResponse(farmer);
  res.status(201).json(result);
});

// ---------- POST /farmers/:farmerId/complete (promote pre→full) ----------
// Promotes a pre_registered farmer to fully_registered. Accepts the missing KYC fields
// (national ID, sex, DOB, household details, etc.) and marks the farmer 'active'.
router.post("/farmers/:farmerId/complete", requirePermission("farmers.register"), async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [existing] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId as string));
  if (!existing) { res.status(404).json({ error: "Farmer not found" }); return; }
  if (existing.registrationStage === "fully_registered") {
    res.status(409).json({ error: "Farmer is already fully registered", code: "ALREADY_FULLY_REGISTERED" });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Decide what the minimum required fields are. When an admin has published a
  // registration template, IT is the source of truth — we just collect whatever
  // the form submits and let the stage computation below decide partially vs
  // fully. When NO template exists, fall back to the legacy "nationalId required
  // to be fully_registered" rule so behaviour is unchanged for existing tenants.
  const tplForComplete = await getActiveTemplate("UG");
  const nationalId = typeof body.nationalId === "string" ? body.nationalId.trim() : "";
  if (!tplForComplete && !nationalId) {
    res.status(400).json({ error: "nationalId is required to complete registration", code: "NATIONAL_ID_REQUIRED" });
    return;
  }
  // Build the patch WITHOUT the stage fields; we'll fill those in after we know
  // the merged farmer state and crops count (so stage reflects the post-write
  // reality, not the pre-write one).
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  if (nationalId) patch.nationalId = nationalId;
  // Selectively accept the rest of the KYC fields. We deliberately don't allow overwriting
  // groupId here — group transfers go through their own endpoint with the correct audit trail.
  if (typeof body.dateOfBirth === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dateOfBirth)) patch.dateOfBirth = body.dateOfBirth;
  if (typeof body.sex === "string" && body.sex.trim()) patch.sex = body.sex.trim();
  if (typeof body.householdSize === "number") patch.householdSize = body.householdSize;
  if (typeof body.dependants === "number") patch.dependants = body.dependants;
  if (typeof body.headOfHousehold === "string" && body.headOfHousehold.trim()) patch.headOfHousehold = body.headOfHousehold.trim();
  if (typeof body.landTenure === "string" && body.landTenure.trim()) patch.landTenure = body.landTenure.trim();
  if (typeof body.village === "string" && body.village.trim()) patch.village = body.village.trim();
  if (typeof body.phoneNumber === "string" && body.phoneNumber.trim()) patch.phoneNumber = body.phoneNumber.trim();

  // Merge in farm + livelihood fields.
  Object.assign(patch, pickLivelihoodPatch(body));

  // crops[]: when provided as an array, REPLACE the farmer's crop set (the form is the
  // authoritative snapshot at completion time). When omitted OR explicitly null, leave
  // existing crops untouched — never wipe on accident. Any other type (string, object,
  // number, etc.) is rejected so callers get an explicit error instead of silent data loss.
  const rawCrops = (body as Record<string, unknown>).crops;
  const cropsKeyPresent = Array.isArray(rawCrops);
  if (rawCrops !== undefined && rawCrops !== null && !Array.isArray(rawCrops)) {
    res.status(400).json({ error: "crops must be an array" });
    return;
  }
  let cropsParsed: ParsedCrop[] = [];
  if (cropsKeyPresent) {
    const result = parseCropsInput(body);
    if (!Array.isArray(result)) { res.status(400).json({ error: result.error }); return; }
    cropsParsed = result;
    const commodityErr = await validateCommodityIds(cropsParsed.map(c => c.commodityId));
    if (commodityErr) { res.status(400).json({ error: commodityErr, code: "UNKNOWN_COMMODITY" }); return; }
  }

  // Compute the post-write stage. Crops live in their own table — when the form
  // doesn't include `crops`, count what's already stored so a re-submit that just
  // adds livelihood fields doesn't accidentally downgrade a farmer who already
  // has crops on file. When crops IS in the body, the new submitted set wins
  // (REPLACE-semantics applied below in the transaction).
  let cropsCountForStage = cropsParsed.length;
  if (!cropsKeyPresent) {
    const [{ count: existingCropsCount } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(farmerCropsTable)
      .where(eq(farmerCropsTable.farmerId, farmerId as string));
    cropsCountForStage = Number(existingCropsCount) || 0;
  }
  // Custom field values: validated against the active template's custom field
  // catalog. When the body OMITS `customFieldValues`, treat as "no change" —
  // we fall back to the existing values stored for this farmer so the stage
  // calculation isn't accidentally downgraded by a partial-submit form.
  const bodyHasCustomValues = (req.body as Record<string, unknown>)?.customFieldValues !== undefined;
  const customParse = parseCustomFieldValues(req.body, tplForComplete?.fields ?? []);
  if ("error" in customParse) {
    res.status(400).json({ error: customParse.error });
    return;
  }
  const submittedCustomValues = customParse.values;
  const customValuesForStage: Record<string, string> = bodyHasCustomValues
    ? submittedCustomValues
    : await loadFarmerCustomFieldValues(farmerId as string);

  const mergedFarmer: Record<string, unknown> = { ...existing, ...patch };
  let computedCompleteStage: RegistrationStage = "fully_registered";
  if (tplForComplete) {
    computedCompleteStage =
      computeStageFromTemplate(tplForComplete.fields, mergedFarmer, customValuesForStage, cropsCountForStage) ??
      "fully_registered";
  }
  patch.registrationStage = computedCompleteStage;
  patch.status = computedCompleteStage === "fully_registered" ? "active" : "pending";
  if (computedCompleteStage === "fully_registered") patch.fullyRegisteredAt = new Date();

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(farmersTable).set(patch).where(eq(farmersTable.id, farmerId as string)).returning();
    if (cropsKeyPresent) {
      await tx.delete(farmerCropsTable).where(eq(farmerCropsTable.farmerId, farmerId as string));
      if (cropsParsed.length > 0) {
        await tx.insert(farmerCropsTable).values(cropsParsed.map(c => ({
          farmerId: farmerId as string,
          commodityId: c.commodityId,
          lastHarvestKg: c.lastHarvestKg,
          lastHarvestDate: c.lastHarvestDate,
        })));
      }
    }
    if (bodyHasCustomValues) {
      // Replace-all semantics: blanking a field in the form actually clears it.
      await replaceFarmerCustomFieldValues(tx, farmerId as string, submittedCustomValues);
    }
    return row;
  });
  const result = await buildFarmerResponse(updated);
  res.json(result);
});

router.get("/farmers/duplicates", async (req: AuthedRequest, res): Promise<void> => {
  // Duplicate review is an admin/data-stewardship task that needs visibility across
  // the whole farmer corpus. Per-group field staff are not allowed to see this list.
  if (isUserScoped(req.authedUser)) {
    res.status(403).json({ error: "Duplicate review is not available for assigned-only users" });
    return;
  }
  const farmers = await db.select().from(farmersTable).limit(100);
  const pairs: any[] = [];
  for (let i = 0; i < farmers.length; i++) {
    for (let j = i + 1; j < farmers.length; j++) {
      const a = farmers[i];
      const b = farmers[j];
      const reasons: string[] = [];
      if (a.nationalId && b.nationalId && a.nationalId === b.nationalId) reasons.push("national_id_match");
      if (a.firstName === b.firstName && a.lastName === b.lastName) reasons.push("name_match");
      if (reasons.length > 0) {
        pairs.push({
          id: `${a.id}-${b.id}`,
          farmer1: { ...a, groupName: null },
          farmer2: { ...b, groupName: null },
          matchScore: reasons.length * 0.5,
          matchReasons: reasons,
          status: "pending",
        });
      }
    }
  }
  res.json(pairs.slice(0, 20));
});

router.post("/farmers/duplicates/:pairId/merge", async (req: AuthedRequest, res): Promise<void> => {
  // Same scope rule as the duplicates list: scoped users can't merge across the corpus.
  if (isUserScoped(req.authedUser)) {
    res.status(403).json({ error: "Duplicate merge is not available for assigned-only users" });
    return;
  }
  const { masterFarmerId } = req.body;
  if (!masterFarmerId) {
    res.status(400).json({ error: "masterFarmerId required" });
    return;
  }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, masterFarmerId));
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const result = await buildFarmerResponse(farmer);
  res.json(result);
});

router.get("/farmers/:farmerId", async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId as string));
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const [plots, enrolments, surveys, gapScores, customFieldValues] = await Promise.all([
    db.select().from(plotsTable).where(eq(plotsTable.farmerId, farmerId as string)),
    db.select({
      enrolment: certificationEnrolmentsTable,
      streamName: certificationStreamsTable.name,
    }).from(certificationEnrolmentsTable)
      .leftJoin(certificationStreamsTable, eq(certificationEnrolmentsTable.streamId, certificationStreamsTable.id))
      .where(eq(certificationEnrolmentsTable.farmerId, farmerId as string)),
    db.select().from(surveySubmissionsTable).where(eq(surveySubmissionsTable.farmerId, farmerId as string)).orderBy(desc(surveySubmissionsTable.submittedAt)).limit(5),
    db.select().from(gapAssessmentsTable).where(eq(gapAssessmentsTable.farmerId, farmerId as string)).orderBy(desc(gapAssessmentsTable.assessedAt)).limit(1),
    loadFarmerCustomFieldValues(farmerId as string),
  ]);
  const group = farmer.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, farmer.groupId)).limit(1)
    : [];
  const result = {
    ...farmer,
    groupName: group[0]?.name ?? null,
    plots: plots.map(p => ({ ...p, areaHectares: parseFloat(p.areaHectares ?? "0") })),
    certifications: enrolments.map(e => ({ ...e.enrolment, streamName: e.streamName ?? "Unknown" })),
    recentSurveys: surveys.map(s => ({ ...s, templateName: "Survey", agentName: "Agent", farmerName: `${farmer.firstName} ${farmer.lastName}` })),
    gapScore: gapScores[0] ? parseFloat(gapScores[0].overallScore ?? "0") : null,
    customFieldValues,
  };
  res.json(result);
});

router.patch("/farmers/:farmerId", async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const parsed = UpdateFarmerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Defense in depth: if the patch tries to MOVE the farmer into a different group,
  // the caller must also be assigned to the destination group. Group transfers go
  // through the dedicated transfer endpoint normally, but PATCH technically allows
  // a groupId update too.
  const patchData = parsed.data as { groupId?: string; regionId?: string };
  if (isUserScoped(req.authedUser) && typeof patchData.groupId === "string") {
    const assigned = await getAssignedGroupIds(req.authedUser!.id);
    if (!assigned.has(patchData.groupId)) {
      res.status(403).json({ error: "You are not assigned to the destination group" });
      return;
    }
  }
  // Org-region consistency: if either groupId or regionId is being changed, the
  // resulting (farmer.regionId, farmer.group.regionId) pair must still share
  // the same District ancestor. This preserves the implicit org-region binding
  // established at preregister time. Edits that don't touch either field skip
  // the check (e.g. updating phone number).
  if (typeof patchData.groupId === "string" || typeof patchData.regionId === "string") {
    const [existing] = await db
      .select({ groupId: farmersTable.groupId, regionId: farmersTable.regionId })
      .from(farmersTable)
      .where(eq(farmersTable.id, farmerId as string));
    if (!existing) { res.status(404).json({ error: "Farmer not found" }); return; }
    const nextGroupId = patchData.groupId ?? existing.groupId;
    const nextRegionId = patchData.regionId ?? existing.regionId;
    if (nextGroupId && nextRegionId) {
      // Multi-district groups: farmer's district must be in the group's covered set.
      const [farmerDistrict, groupDistricts] = await Promise.all([
        getDistrictAncestorId(nextRegionId),
        getGroupDistrictIds(nextGroupId),
      ]);
      if (!farmerDistrict || groupDistricts.size === 0 || !groupDistricts.has(farmerDistrict)) {
        res.status(400).json({
          error: "Farmer's village district must be one of the group's covered districts",
          code: "FARMER_GROUP_DISTRICT_MISMATCH",
        });
        return;
      }
    }
  }
  const [farmer] = await db.update(farmersTable).set({ ...parsed.data, updatedAt: new Date() }).where(eq(farmersTable.id, farmerId as string)).returning();
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const result = await buildFarmerResponse(farmer);
  res.json(result);
});

router.get("/farmers/:farmerId/card", async (req: AuthedRequest, res): Promise<void> => {
  const { farmerId } = req.params;
  const denied = await checkFarmerAccess(farmerId as string, req.authedUser);
  if (denied) { res.status(denied.status).json({ error: denied.error }); return; }
  const [farmer] = await db.select().from(farmersTable).where(eq(farmersTable.id, farmerId as string));
  if (!farmer) {
    res.status(404).json({ error: "Farmer not found" });
    return;
  }
  const enrolments = await db.select({
    enrolment: certificationEnrolmentsTable,
    streamName: certificationStreamsTable.name,
  }).from(certificationEnrolmentsTable)
    .leftJoin(certificationStreamsTable, eq(certificationEnrolmentsTable.streamId, certificationStreamsTable.id))
    .where(eq(certificationEnrolmentsTable.farmerId, farmerId as string));
  const group = farmer.groupId
    ? await db.select().from(groupsTable).where(eq(groupsTable.id, farmer.groupId)).limit(1)
    : [];
  res.json({
    farmerId: farmer.id,
    referenceNumber: farmer.referenceNumber,
    fullName: `${farmer.firstName} ${farmer.lastName}`,
    photoUrl: farmer.photoUrl,
    groupName: group[0]?.name ?? "",
    village: farmer.village ?? "",
    qrCodeData: `AGRI:${farmer.referenceNumber}`,
    certifications: enrolments.map(e => ({
      streamName: e.streamName ?? "Unknown",
      status: e.enrolment.status,
      expiryDate: e.enrolment.expiryDate,
    })),
  });
});

export default router;
