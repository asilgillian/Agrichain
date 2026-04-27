import { useMemo } from "react";
import { useListRegions, useListCountryHierarchies } from "@workspace/api-client-react";

type RegionRow = { id: string; level: number | null; countryCode: string | null };
type Hierarchy = { countryCode: string; levels: { level: number; name: string }[] };

/**
 * Returns whether the given regionId points to the deepest configured admin
 * level for its country (e.g. UG/KE Village = level 4). Also returns the
 * leaf level name for use in error messages.
 *
 * This mirrors the server-side `validateGroupRegionIsLeaf` so the UI can
 * disable Save before the request is sent.
 */
export function useIsLeafRegion(regionId: string): {
  isLeaf: boolean;
  loading: boolean;
  leafName: string | null;
} {
  const { data: regions, isLoading: rLoading } = useListRegions();
  const { data: hierarchies, isLoading: hLoading } = useListCountryHierarchies();

  return useMemo(() => {
    const loading = rLoading || hLoading;
    if (loading || !regionId) return { isLeaf: false, loading, leafName: null };

    const allRegions = (regions ?? []) as unknown as RegionRow[];
    const allHier = (hierarchies ?? []) as unknown as Hierarchy[];

    const region = allRegions.find(r => r.id === regionId);
    if (!region || !region.countryCode) return { isLeaf: false, loading: false, leafName: null };

    const hier = allHier.find(h => h.countryCode === region.countryCode);
    if (!hier || !hier.levels?.length) return { isLeaf: false, loading: false, leafName: null };

    const max = hier.levels.reduce((m, l) => Math.max(m, l.level), 0);
    const leafName = hier.levels.find(l => l.level === max)?.name ?? null;
    return { isLeaf: region.level === max, loading: false, leafName };
  }, [regionId, regions, hierarchies, rLoading, hLoading]);
}
