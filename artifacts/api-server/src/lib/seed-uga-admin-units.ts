import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { db, regionsTable } from "@workspace/db";
import ugaGzPath from "../data/uga-admin-units-2022.json.gz";

type Row = {
  district: string;
  district_code: string | null;
  constituency: string | null;
  constituency_code: string | null;
  subcounty: string;
  subcounty_code: string | null;
  parish: string;
  parish_code: string | null;
  village: string;
  village_code: string | null;
};

const COUNTRY = "UG";

// Map PDF district names to existing prod L2 names where they differ.
// Spelling variants + the 9 City districts that fold back into their parent district.
const DISTRICT_ALIASES: Record<string, string> = {
  LUWEERO: "Luwero",
  KALANGALA: "Kalanga",
  KITAGWENDA: "Kitagwenga",
  RUBIRIZI: "Rubirzi",
  "FORT PORTAL CITY": "Kabarole",
};

const norm = (s: string | null | undefined): string =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function pdfToProdDistrict(pdfName: string): string {
  if (DISTRICT_ALIASES[pdfName]) return DISTRICT_ALIASES[pdfName];
  if (pdfName.endsWith(" CITY")) return pdfName.replace(/ CITY$/, "");
  return pdfName;
}

// Title-case PDF ALLCAPS while preserving Roman numerals (I, II, III…).
const ROMAN_RE = /^(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/i;
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (ROMAN_RE.test(word)) return word.toUpperCase();
      return word.replace(/(^|[\s/\-'])(.)/g, (_m, p: string, c: string) => p + c.toUpperCase());
    })
    .join(" ")
    .trim();
}

export type SeedReport = {
  dryRun: boolean;
  loadedRows: number;
  distinctSubcounties: number;
  distinctParishes: number;
  distinctVillages: number;
  l3Created: number;
  l3ExistingUsed: number;
  l4Created: number;
  l4Skipped: number;
  l5Created: number;
  l5Skipped: number;
  unmappedDistricts: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

const BATCH_SIZE = 1000;

type InsertValue = { name: string; level: number; parentId: string; countryCode: string; code: string | null };
type InsertedRow = { id: string; name: string; parentId: string | null };

// In-process mutex: rejects concurrent calls so a double-click on the admin
// button cannot race-insert duplicate rows. Process-local only — assumes a
// single API replica (current deploy topology). If we scale out, replace this
// with a Postgres advisory lock (pg_try_advisory_xact_lock).
let seedInFlight = false;

export class SeedAlreadyRunningError extends Error {
  constructor() {
    super("A Uganda admin-units seed is already running. Wait for it to finish before retrying.");
    this.name = "SeedAlreadyRunningError";
  }
}

async function batchInsert(
  tx: { insert: typeof db.insert },
  values: InsertValue[],
): Promise<InsertedRow[]> {
  const out: InsertedRow[] = [];
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const chunk = values.slice(i, i + BATCH_SIZE);
    const inserted = await tx
      .insert(regionsTable)
      .values(chunk)
      .returning({ id: regionsTable.id, name: regionsTable.name, parentId: regionsTable.parentId });
    out.push(...inserted);
  }
  return out;
}

export async function seedUgaAdminUnits(opts: { dryRun?: boolean } = {}): Promise<SeedReport> {
  const dryRun = !!opts.dryRun;
  // Dry-runs don't write, so the mutex only guards the apply path.
  if (!dryRun) {
    if (seedInFlight) throw new SeedAlreadyRunningError();
    seedInFlight = true;
  }
  try {
    return await seedInner(dryRun);
  } finally {
    if (!dryRun) seedInFlight = false;
  }
}

async function seedInner(dryRun: boolean): Promise<SeedReport> {
  const startedAt = new Date();

  // 1. Decompress + parse bundled JSON (esbuild copies the gz file next to the bundle)
  const resolved = ugaGzPath.startsWith("file:")
    ? fileURLToPath(ugaGzPath)
    : new URL(ugaGzPath, import.meta.url).pathname;
  const buf = readFileSync(resolved);
  const rows: Row[] = JSON.parse(gunzipSync(buf).toString("utf8"));

  // 2. Load existing UG regions for lookup + idempotency
  const all = await db
    .select({
      id: regionsTable.id,
      name: regionsTable.name,
      level: regionsTable.level,
      parentId: regionsTable.parentId,
    })
    .from(regionsTable)
    .where(eq(regionsTable.countryCode, COUNTRY));

  const l2 = all.filter((r) => r.level === 2);
  const l3 = all.filter((r) => r.level === 3);
  const l4 = all.filter((r) => r.level === 4);
  const l5 = all.filter((r) => r.level === 5);

  const l2ByNorm = new Map<string, string>(l2.map((r) => [norm(r.name), r.id]));
  const l2NameById = new Map<string, string>(l2.map((r) => [r.id, r.name]));

  // L3 keyed by "DISTRICT|SUBCOUNTY" → l3.id
  const l3IdByPdfKey = new Map<string, string>();
  for (const r of l3) {
    if (!r.parentId) continue;
    const dist = l2NameById.get(r.parentId);
    if (!dist) continue;
    l3IdByPdfKey.set(`${norm(dist)}|${norm(r.name)}`, r.id);
  }

  // L4 keyed by "L3_ID|PARISH" → l4.id (for skip-on-rerun)
  const l4IdByParentKey = new Map<string, string>();
  for (const r of l4) {
    if (!r.parentId) continue;
    l4IdByParentKey.set(`${r.parentId}|${norm(r.name)}`, r.id);
  }

  // L5 keyed by "L4_ID|VILLAGE" → present-or-not
  const l5PresentKeys = new Set<string>();
  for (const r of l5) {
    if (!r.parentId) continue;
    l5PresentKeys.add(`${r.parentId}|${norm(r.name)}`);
  }

  // 3. Project PDF rows into normalized unique-key maps
  const unmappedDistricts = new Set<string>();
  const subPlan = new Map<string, { prodDistId: string; subName: string }>();
  const parishPlan = new Map<string, { subKey: string; parishName: string }>();
  const villagePlan = new Map<string, { parishKey: string; villageName: string }>();

  for (const r of rows) {
    const prodDist = pdfToProdDistrict(r.district);
    const distId = l2ByNorm.get(norm(prodDist));
    if (!distId) {
      unmappedDistricts.add(r.district);
      continue;
    }
    const subKey = `${norm(prodDist)}|${norm(r.subcounty)}`;
    if (!subPlan.has(subKey)) subPlan.set(subKey, { prodDistId: distId, subName: r.subcounty });
    const parishKey = `${subKey}|${norm(r.parish)}`;
    if (!parishPlan.has(parishKey)) parishPlan.set(parishKey, { subKey, parishName: r.parish });
    const villageKey = `${parishKey}|${norm(r.village)}`;
    if (!villagePlan.has(villageKey)) villagePlan.set(villageKey, { parishKey, villageName: r.village });
  }

  // 4. L3 — insert any subcounty key that does not already exist
  const l3Inserts: InsertValue[] = [];
  const l3InsertOrder: string[] = []; // parallel array of subKeys to map back after insert
  let l3ExistingUsed = 0;
  for (const [subKey, info] of subPlan) {
    if (l3IdByPdfKey.has(subKey)) {
      l3ExistingUsed++;
      continue;
    }
    l3InsertOrder.push(subKey);
    l3Inserts.push({
      name: titleCase(info.subName),
      level: 3,
      parentId: info.prodDistId,
      countryCode: COUNTRY,
      code: null,
    });
  }
  if (dryRun) {
    // No DB writes: just return the planned counts (and assign synthetic IDs so L5 plan works).
    for (let i = 0; i < l3Inserts.length; i++) {
      l3IdByPdfKey.set(l3InsertOrder[i]!, `__dry_l3_${i}`);
    }
  }

  // 5. L4 — parishes under their L3 (skip if (l3_id, parish) already exists)
  const l4Inserts: InsertValue[] = [];
  const l4InsertOrder: string[] = []; // parallel parishKeys
  // parishKey -> l4 id, populated from both existing rows and rows we (will) insert
  const l4IdByPdfKey = new Map<string, string>();
  let l4Skipped = 0;
  for (const [parishKey, info] of parishPlan) {
    const l3Id = l3IdByPdfKey.get(info.subKey);
    if (!l3Id) {
      l4Skipped++;
      continue;
    }
    if (!dryRun) {
      const existingL4 = l4IdByParentKey.get(`${l3Id}|${norm(info.parishName)}`);
      if (existingL4) {
        l4IdByPdfKey.set(parishKey, existingL4);
        l4Skipped++;
        continue;
      }
    }
    l4InsertOrder.push(parishKey);
    l4Inserts.push({
      name: titleCase(info.parishName),
      level: 4,
      parentId: l3Id.startsWith("__dry_") ? "00000000-0000-0000-0000-000000000000" : l3Id,
      countryCode: COUNTRY,
      code: null,
    });
    if (dryRun) l4IdByPdfKey.set(parishKey, `__dry_l4_${l4InsertOrder.length - 1}`);
  }

  // 6. L5 plan — villages under their L4 (uses l4IdByPdfKey populated above
  // for dry-run; for the apply path, L4 IDs are filled in inside the transaction)
  const l5Plan: Array<{ parishKey: string; villageName: string }> = [];
  let l5Skipped = 0;
  for (const [, info] of villagePlan) {
    const haveL4 = l4IdByPdfKey.has(info.parishKey) ||
      (!dryRun && l4InsertOrder.includes(info.parishKey)) ||
      (!dryRun && l4IdByParentKey.has(`${l3IdByPdfKey.get(parishPlan.get(info.parishKey)!.subKey)}|${norm(info.villageName)}`));
    if (!haveL4 && !l4InsertOrder.includes(info.parishKey) && !l4IdByPdfKey.has(info.parishKey)) {
      l5Skipped++;
      continue;
    }
    l5Plan.push({ parishKey: info.parishKey, villageName: info.villageName });
  }

  let l5Created = 0;

  if (!dryRun && (l3Inserts.length > 0 || l4Inserts.length > 0 || l5Plan.length > 0)) {
    // Wrap all writes in one transaction so a mid-run failure rolls back cleanly.
    await db.transaction(async (tx) => {
      // L3
      if (l3Inserts.length > 0) {
        const created = await batchInsert(tx, l3Inserts);
        for (let i = 0; i < created.length; i++) {
          const subKey = l3InsertOrder[i]!;
          l3IdByPdfKey.set(subKey, created[i]!.id);
        }
        // Re-point any L4 inserts whose parent was a freshly-created L3
        for (const ins of l4Inserts) {
          if (ins.parentId === "00000000-0000-0000-0000-000000000000") {
            // Find which subKey produced this parish in l4InsertOrder
            const idx = l4Inserts.indexOf(ins);
            const parishKey = l4InsertOrder[idx]!;
            const subKey = parishPlan.get(parishKey)!.subKey;
            const realId = l3IdByPdfKey.get(subKey);
            if (realId && !realId.startsWith("__dry_")) ins.parentId = realId;
          }
        }
      }
      // L4
      if (l4Inserts.length > 0) {
        const created = await batchInsert(tx, l4Inserts);
        for (let i = 0; i < created.length; i++) {
          l4IdByPdfKey.set(l4InsertOrder[i]!, created[i]!.id);
        }
      }
      // L5 — build final insert list now that all L4 IDs are real
      const l5Inserts: InsertValue[] = [];
      for (const v of l5Plan) {
        const l4Id = l4IdByPdfKey.get(v.parishKey);
        if (!l4Id || l4Id.startsWith("__dry_")) {
          l5Skipped++;
          continue;
        }
        const presentKey = `${l4Id}|${norm(v.villageName)}`;
        if (l5PresentKeys.has(presentKey)) {
          l5Skipped++;
          continue;
        }
        l5PresentKeys.add(presentKey); // guard against duplicate village names within same parish in the PDF
        l5Inserts.push({
          name: titleCase(v.villageName),
          level: 5,
          parentId: l4Id,
          countryCode: COUNTRY,
          code: null,
        });
      }
      if (l5Inserts.length > 0) {
        await batchInsert(tx, l5Inserts);
        l5Created = l5Inserts.length;
      }
    });
  } else if (dryRun) {
    l5Created = l5Plan.length;
  }

  const finishedAt = new Date();
  return {
    dryRun,
    loadedRows: rows.length,
    distinctSubcounties: subPlan.size,
    distinctParishes: parishPlan.size,
    distinctVillages: villagePlan.size,
    l3Created: l3Inserts.length,
    l3ExistingUsed,
    l4Created: l4Inserts.length,
    l4Skipped,
    l5Created,
    l5Skipped,
    unmappedDistricts: [...unmappedDistricts].sort(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}
