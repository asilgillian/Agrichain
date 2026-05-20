import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListCountryHierarchies } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export type RegionRow = {
  id: string;
  name: string;
  parentId: string | null;
  level: number | null;
  countryCode: string | null;
  isActive: boolean | null;
};

type CountryHierarchy = {
  countryCode: string;
  countryName: string;
  levels: { level: number; name: string }[];
};

export interface RegionPickerProps {
  value: string;
  onChange: (regionId: string) => void;
  country?: string;
  required?: boolean;
  testIdPrefix?: string;
  /** Hide the per-level <Label> headings (caller renders its own). */
  hideLabels?: boolean;
}

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function fetchRegions(params: { country: string; level?: number; parentId?: string | null }): Promise<RegionRow[]> {
  const qs = new URLSearchParams({ country: params.country });
  if (params.level != null) qs.set("level", String(params.level));
  if (params.parentId !== undefined) qs.set("parentId", params.parentId ?? "null");
  const r = await fetch(`${API_BASE}/api/admin/regions?${qs.toString()}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Failed to load regions (${r.status})`);
  return r.json();
}

async function fetchRegionById(id: string): Promise<RegionRow> {
  const r = await fetch(`${API_BASE}/api/admin/regions/by-id/${id}`, { credentials: "include" });
  if (!r.ok) throw new Error(`Failed to load region ${id}`);
  return r.json();
}

/**
 * Cascading administrative-unit picker. Renders one <Select> per configured
 * level (e.g. District → Sub-county → Parish → Village for Uganda) and writes
 * the deepest selected region id back through `onChange`. Field staff can stop
 * at any level — the recorded `regionId` is whatever leaf they reached.
 *
 * Data is fetched LAZILY, one level at a time, via filtered queries on
 * `/api/admin/regions`. This keeps payloads small (a few hundred rows) even
 * for countries like Uganda where the full regions table is 100k+ rows.
 *
 * When `value` is set from props (e.g. editing an existing record), we walk
 * back up via `/admin/regions/by-id/{id}` to derive the per-level path.
 */
export function RegionPicker({
  value,
  onChange,
  country = "UG",
  required,
  testIdPrefix = "region-picker",
  hideLabels = false,
}: RegionPickerProps) {
  const { data: hierarchies, isLoading: hierLoading } = useListCountryHierarchies();
  const countryHier = ((hierarchies ?? []) as unknown as CountryHierarchy[])
    .find(h => h.countryCode === country);
  const levels = useMemo(
    () => countryHier?.levels.slice().sort((a, b) => a.level - b.level) ?? [{ level: 1, name: "Region" }],
    [countryHier],
  );

  // Walk the current `value` back up to its root so we know which id is selected
  // at each level. Stops as soon as we hit a level-1 node. Cached per (value).
  const { data: ancestry, isLoading: ancestryLoading } = useQuery<RegionRow[]>({
    queryKey: ["region-ancestry", value],
    enabled: !!value,
    queryFn: async () => {
      const chain: RegionRow[] = [];
      let cursor: string | null = value;
      // Hard cap at 10 hops to defend against accidental cycles.
      for (let i = 0; cursor && i < 10; i++) {
        const node = await fetchRegionById(cursor);
        chain.push(node);
        cursor = node.parentId;
      }
      return chain;
    },
  });

  // selections[idx] = the id selected at level idx+1 (or "" if not yet picked)
  const selections = useMemo(() => {
    const out: string[] = Array(levels.length).fill("");
    for (const node of ancestry ?? []) {
      const lvl = node.level ?? 1;
      const idx = lvl - 1;
      if (idx >= 0 && idx < out.length) out[idx] = node.id;
    }
    return out;
  }, [ancestry, levels.length]);

  const pickAt = (idx: number, regionId: string) => {
    if (!regionId) {
      const parentId = idx > 0 ? selections[idx - 1] : "";
      onChange(parentId);
      return;
    }
    onChange(regionId);
  };

  if (hierLoading || (value && ancestryLoading)) {
    return (
      <div className="space-y-2" data-testid={`${testIdPrefix}-loading`}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {levels.map((lvl, idx) => {
        const parentId = idx === 0 ? null : selections[idx - 1] || null;
        if (idx > 0 && !parentId) return null;
        return (
          <LevelSelect
            key={lvl.level}
            country={country}
            level={lvl.level}
            parentId={parentId}
            levelName={lvl.name}
            selected={selections[idx] || ""}
            onPick={(v) => pickAt(idx, v)}
            star={!!required && idx === 0}
            hideLabel={hideLabels}
            testIdPrefix={testIdPrefix}
          />
        );
      })}
    </div>
  );
}

function LevelSelect({
  country, level, parentId, levelName, selected, onPick, star, hideLabel, testIdPrefix,
}: {
  country: string;
  level: number;
  parentId: string | null;
  levelName: string;
  selected: string;
  onPick: (id: string) => void;
  star: boolean;
  hideLabel: boolean;
  testIdPrefix: string;
}) {
  // Lazy: only fetch options for THIS level under THIS parent. Cached per
  // (country, level, parentId) so re-opening the picker is instant.
  const { data, isLoading } = useQuery<RegionRow[]>({
    queryKey: ["regions-by-parent", country, level, parentId ?? "root"],
    queryFn: () => fetchRegions({ country, level, parentId }),
  });
  const opts = useMemo(
    () => (data ?? []).filter(r => r.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  return (
    <div>
      {!hideLabel && <Label className="text-xs">{levelName}{star ? " *" : ""}</Label>}
      <Select value={selected} onValueChange={onPick}>
        <SelectTrigger data-testid={`${testIdPrefix}-level-${level}`}>
          <SelectValue placeholder={
            isLoading ? `Loading ${levelName.toLowerCase()}s…`
            : opts.length === 0 ? `No ${levelName.toLowerCase()}s available`
            : `Select ${levelName.toLowerCase()}`
          } />
        </SelectTrigger>
        <SelectContent>
          {opts.map(r => (
            <SelectItem key={r.id} value={r.id} data-testid={`${testIdPrefix}-option-${r.id}`}>
              {r.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
