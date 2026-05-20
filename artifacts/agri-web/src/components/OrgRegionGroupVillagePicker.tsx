import { useQuery } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export type OrgRegionRow = { id: string; name: string; description?: string | null; districtCount?: number };
export type OrgRegionGroupRow = { id: string; name: string; regionId?: string | null };
export type OrgRegionVillageRow = { id: string; name: string; level: number };

export interface OrgRegionGroupVillagePickerProps {
  orgRegionId: string;
  groupId: string;
  villageId: string;
  onChange: (next: { orgRegionId: string; groupId: string; villageId: string }) => void;
  testIdPrefix?: string;
  hideLabels?: boolean;
}

/**
 * Three-level cascading picker: Organisational Region → Group → Village.
 * Mirrors mobile's OrgRegionGroupVillagePicker so web and mobile farmer
 * registration produce the same data shape (orgRegionId + groupId + villageId).
 * Choosing a parent level resets the children below it.
 */
export function OrgRegionGroupVillagePicker({
  orgRegionId,
  groupId,
  villageId,
  onChange,
  testIdPrefix = "ogv",
  hideLabels = false,
}: OrgRegionGroupVillagePickerProps) {
  const orgRegionsQ = useQuery<OrgRegionRow[]>({
    queryKey: ["/api/org-regions"],
    queryFn: () => fetch(`${API_BASE}/api/org-regions`).then(r => {
      if (!r.ok) throw new Error(`Failed to load regions (${r.status})`);
      return r.json();
    }),
    staleTime: 60_000,
  });

  const groupsQ = useQuery<OrgRegionGroupRow[]>({
    queryKey: ["/api/org-regions/groups", orgRegionId],
    enabled: !!orgRegionId,
    queryFn: () => fetch(`${API_BASE}/api/org-regions/${orgRegionId}/groups`).then(r => {
      if (!r.ok) throw new Error(`Failed to load groups (${r.status})`);
      return r.json();
    }),
    staleTime: 60_000,
  });

  const villagesQ = useQuery<OrgRegionVillageRow[]>({
    queryKey: ["/api/org-regions/villages", orgRegionId],
    enabled: !!orgRegionId,
    queryFn: () => fetch(`${API_BASE}/api/org-regions/${orgRegionId}/villages`).then(r => {
      if (!r.ok) throw new Error(`Failed to load villages (${r.status})`);
      return r.json();
    }),
    staleTime: 60_000,
  });

  const orgRegions = orgRegionsQ.data ?? [];
  const groups = groupsQ.data ?? [];
  const villages = villagesQ.data ?? [];

  if (orgRegionsQ.isLoading) {
    return (
      <div className="space-y-2" data-testid={`${testIdPrefix}-loading`}>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        {!hideLabels && <Label className="text-xs mb-1 block">Region *</Label>}
        <Select
          value={orgRegionId}
          onValueChange={(v) => onChange({ orgRegionId: v, groupId: "", villageId: "" })}
        >
          <SelectTrigger data-testid={`${testIdPrefix}-region`}>
            <SelectValue placeholder={orgRegions.length === 0 ? "No regions available" : "Select region"} />
          </SelectTrigger>
          <SelectContent>
            {orgRegions.map(r => (
              <SelectItem key={r.id} value={r.id} data-testid={`${testIdPrefix}-region-option-${r.id}`}>
                {r.name}
                {typeof r.districtCount === "number" ? ` (${r.districtCount} districts)` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {orgRegionId && (
        <div>
          {!hideLabels && <Label className="text-xs mb-1 block">Group *</Label>}
          <Select
            value={groupId}
            onValueChange={(v) => onChange({ orgRegionId, groupId: v, villageId })}
            disabled={groupsQ.isLoading}
          >
            <SelectTrigger data-testid={`${testIdPrefix}-group`}>
              <SelectValue placeholder={
                groupsQ.isLoading ? "Loading…"
                  : groups.length === 0 ? "No groups in this region"
                    : "Select group"
              } />
            </SelectTrigger>
            <SelectContent>
              {groups.map(g => (
                <SelectItem key={g.id} value={g.id} data-testid={`${testIdPrefix}-group-option-${g.id}`}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {orgRegionId && (
        <div>
          {!hideLabels && <Label className="text-xs mb-1 block">Village *</Label>}
          <Select
            value={villageId}
            onValueChange={(v) => onChange({ orgRegionId, groupId, villageId: v })}
            disabled={villagesQ.isLoading}
          >
            <SelectTrigger data-testid={`${testIdPrefix}-village`}>
              <SelectValue placeholder={
                villagesQ.isLoading ? "Loading…"
                  : villages.length === 0 ? "No villages in this region"
                    : "Select village"
              } />
            </SelectTrigger>
            <SelectContent>
              {villages.map(v => (
                <SelectItem key={v.id} value={v.id} data-testid={`${testIdPrefix}-village-option-${v.id}`}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
