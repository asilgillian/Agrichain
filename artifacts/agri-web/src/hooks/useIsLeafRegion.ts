import { useQuery } from "@tanstack/react-query";
import { useListCountryHierarchies } from "@workspace/api-client-react";

type RegionRow = { id: string; level: number | null; countryCode: string | null };
type Hierarchy = { countryCode: string; levels: { level: number; name: string }[] };

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

/**
 * Returns whether the given regionId points to the deepest configured admin
 * level for its country (e.g. UG Village = level 5). Also returns the
 * leaf level name for use in error messages.
 *
 * Fetches the single region by id instead of pulling the full regions list,
 * so it stays fast even with a 100k-row regions table.
 */
export function useIsLeafRegion(regionId: string): {
  isLeaf: boolean;
  loading: boolean;
  leafName: string | null;
} {
  const { data: region, isLoading: rLoading } = useQuery<RegionRow>({
    queryKey: ["region-by-id", regionId],
    enabled: !!regionId,
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/regions/by-id/${regionId}`, { credentials: "include" });
      if (!r.ok) throw new Error(`Failed to load region`);
      return r.json();
    },
  });
  const { data: hierarchies, isLoading: hLoading } = useListCountryHierarchies();

  const loading = (!!regionId && rLoading) || hLoading;
  if (loading || !regionId) return { isLeaf: false, loading, leafName: null };
  if (!region || !region.countryCode) return { isLeaf: false, loading: false, leafName: null };

  const allHier = (hierarchies ?? []) as unknown as Hierarchy[];
  const hier = allHier.find(h => h.countryCode === region.countryCode);
  if (!hier || !hier.levels?.length) return { isLeaf: false, loading: false, leafName: null };

  const max = hier.levels.reduce((m, l) => Math.max(m, l.level), 0);
  const leafName = hier.levels.find(l => l.level === max)?.name ?? null;
  return { isLeaf: region.level === max, loading: false, leafName };
}
