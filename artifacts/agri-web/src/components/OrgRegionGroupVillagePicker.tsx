import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ChevronsUpDown, Search } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

export type OrgRegionRow = { id: string; name: string; description?: string | null; districtCount?: number };
export type OrgRegionGroupRow = { id: string; name: string; regionId?: string | null };
export type OrgRegionVillageRow = { id: string; name: string; level: number };

export interface OrgRegionGroupVillagePickerProps {
  orgRegionId: string;
  groupId: string;
  villageId: string;
  onChange: (next: { orgRegionId: string; groupId: string; villageId: string; villageName: string }) => void;
  testIdPrefix?: string;
  hideLabels?: boolean;
  /** Hide the Group level (Region → Village only). Used by forms with no group concept (suppliers, groups). */
  showGroup?: boolean;
  /** Show the "*" required marker on labels. Set false when the selection is optional. */
  requiredMark?: boolean;
}

/**
 * Three-level cascading picker: Organisational Region → Group → Village.
 * Mirrors mobile's OrgRegionGroupVillagePicker so web and mobile farmer
 * registration produce the same data shape (orgRegionId + groupId + villageId).
 * Choosing a parent level resets the children below it. Group and Village are
 * searchable comboboxes (lists can be hundreds long).
 */
export function OrgRegionGroupVillagePicker({
  orgRegionId,
  groupId,
  villageId,
  onChange,
  testIdPrefix = "ogv",
  hideLabels = false,
  showGroup = true,
  requiredMark = true,
}: OrgRegionGroupVillagePickerProps) {
  const mark = requiredMark ? " *" : "";
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

  const selectedGroup = groups.find(g => g.id === groupId);
  const selectedVillage = villages.find(v => v.id === villageId);

  return (
    <div className="space-y-3">
      <div>
        {!hideLabels && <Label className="text-xs mb-1 block">Region{mark}</Label>}
        <Select
          value={orgRegionId}
          onValueChange={(v) => onChange({ orgRegionId: v, groupId: "", villageId: "", villageName: "" })}
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

      {showGroup && orgRegionId && (
        <div>
          {!hideLabels && <Label className="text-xs mb-1 block">Group{mark}</Label>}
          <SearchableCombo
            testId={`${testIdPrefix}-group`}
            placeholder={
              groupsQ.isLoading ? "Loading…"
                : groups.length === 0 ? "No groups in this region"
                  : "Select group"
            }
            disabled={groupsQ.isLoading}
            selectedLabel={selectedGroup?.name}
            items={groups.map(g => ({ id: g.id, label: g.name }))}
            value={groupId}
            onChange={(id) => onChange({ orgRegionId, groupId: id, villageId, villageName: selectedVillage?.name ?? "" })}
            emptyLabel="No groups found."
            searchPlaceholder="Search groups…"
          />
        </div>
      )}

      {orgRegionId && (
        <div>
          {!hideLabels && <Label className="text-xs mb-1 block">Village{mark}</Label>}
          <SearchableCombo
            testId={`${testIdPrefix}-village`}
            placeholder={
              villagesQ.isLoading ? "Loading…"
                : villages.length === 0 ? "No villages in this region"
                  : "Select village"
            }
            disabled={villagesQ.isLoading}
            selectedLabel={selectedVillage?.name}
            items={villages.map(v => ({ id: v.id, label: v.name }))}
            value={villageId}
            onChange={(id) => onChange({ orgRegionId, groupId, villageId: id, villageName: villages.find(v => v.id === id)?.name ?? "" })}
            emptyLabel="No villages found."
            searchPlaceholder="Search villages…"
          />
        </div>
      )}
    </div>
  );
}

type ComboItem = { id: string; label: string };

function SearchableCombo({
  testId,
  placeholder,
  disabled,
  selectedLabel,
  items,
  value,
  onChange,
  emptyLabel,
  searchPlaceholder,
}: {
  testId: string;
  placeholder: string;
  disabled?: boolean;
  selectedLabel?: string;
  items: ComboItem[];
  value: string;
  onChange: (id: string) => void;
  emptyLabel: string;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;
    return list.slice(0, 100);
  }, [items, query]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={selectedLabel ? "" : "text-muted-foreground"}>
            {selectedLabel ?? placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8 h-9"
              data-testid={`${testId}-search`}
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
          ) : (
            filtered.map(i => (
              <button
                key={i.id}
                type="button"
                onClick={() => { onChange(i.id); setOpen(false); setQuery(""); }}
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2"
                data-testid={`${testId}-option-${i.id}`}
              >
                <span className="truncate">{i.label}</span>
                {value === i.id && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
