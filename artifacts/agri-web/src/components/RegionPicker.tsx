import { useEffect, useMemo } from "react";
import { useListRegions, useListCountryHierarchies } from "@workspace/api-client-react";
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

/**
 * Cascading administrative-unit picker. Renders one <Select> per configured
 * level (e.g. District → Sub-county → Parish → Village for Uganda) and writes
 * the deepest selected region id back through `onChange`. Field staff can stop
 * at any level — the recorded `regionId` is whatever leaf they reached.
 *
 * Data source:
 *  - Country hierarchy (level names/depth) from `/api/admin/country-hierarchies`
 *  - Region rows from `/api/admin/regions`, filtered by `countryCode`
 *
 * Both endpoints are gated by the lighter `regions.read` / `hierarchy.read`
 * perms so any signed-in field user can populate the picker.
 */
export function RegionPicker({
  value,
  onChange,
  country = "UG",
  required,
  testIdPrefix = "region-picker",
  hideLabels = false,
}: RegionPickerProps) {
  const { data: regions, isLoading: regionsLoading } = useListRegions();
  const { data: hierarchies, isLoading: hierLoading } = useListCountryHierarchies();

  const allRegions = (regions ?? []) as unknown as RegionRow[];
  const countryHier = ((hierarchies ?? []) as unknown as CountryHierarchy[])
    .find(h => h.countryCode === country);

  // Index regions by id for fast parent walk (includes INACTIVE so that an existing
  // saved value whose ancestor was deactivated is still resolvable in the breadcrumb).
  // The selectable options bucket (`childrenOf`), however, only contains active rows.
  const { byId, childrenOf, levels } = useMemo(() => {
    const byId = new Map<string, RegionRow>();
    const childrenOf = new Map<string | null, RegionRow[]>();
    for (const r of allRegions) {
      if ((r.countryCode ?? "") !== country) continue;
      byId.set(r.id, r); // index everything for ancestor walk
      if (r.isActive === false) continue; // but only offer active rows as choices
      const key = r.parentId ?? null;
      const arr = childrenOf.get(key) ?? [];
      arr.push(r);
      childrenOf.set(key, arr);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    const levels = countryHier?.levels.slice().sort((a, b) => a.level - b.level)
      ?? [{ level: 1, name: "Region" }];
    return { byId, childrenOf, levels };
  }, [allRegions, country, countryHier]);

  // Walk from the selected leaf back to the root to derive the per-level path.
  // selections[0] = level-1 id (or ""), selections[1] = level-2 id, ...
  const selections = useMemo(() => {
    const out: string[] = Array(levels.length).fill("");
    if (!value) return out;
    let node: RegionRow | undefined = byId.get(value);
    while (node) {
      const lvl = node.level ?? 1;
      const idx = lvl - 1;
      if (idx >= 0 && idx < out.length) out[idx] = node.id;
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
    return out;
  }, [value, byId, levels.length]);

  // When the user picks at level `idx`, the deepest selection becomes that id and
  // any deeper selections are cleared. Auto-advance: if the chosen node has
  // exactly one active child, follow it.
  const pickAt = (idx: number, regionId: string) => {
    if (!regionId) {
      const parentId = idx > 0 ? selections[idx - 1] : "";
      onChange(parentId);
      return;
    }
    let cursorId = regionId;
    while (true) {
      const kids = childrenOf.get(cursorId) ?? [];
      if (kids.length === 1) cursorId = kids[0].id;
      else break;
    }
    onChange(cursorId);
  };

  if (regionsLoading || hierLoading) {
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
        // Hide deeper selects until the user picks the parent level.
        if (idx > 0 && !parentId) return null;
        const opts = childrenOf.get(parentId) ?? [];
        const selected = selections[idx] || "";
        const star = required && idx === 0 ? " *" : "";
        return (
          <div key={lvl.level}>
            {!hideLabels && <Label className="text-xs">{lvl.name}{star}</Label>}
            <Select value={selected} onValueChange={v => pickAt(idx, v)}>
              <SelectTrigger data-testid={`${testIdPrefix}-level-${lvl.level}`}>
                <SelectValue placeholder={opts.length === 0 ? `No ${lvl.name.toLowerCase()}s available` : `Select ${lvl.name.toLowerCase()}`} />
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
      })}
    </div>
  );
}
