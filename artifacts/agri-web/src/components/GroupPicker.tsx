import { useState, useMemo } from "react";
import { useListGroups } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ChevronsUpDown, Search } from "lucide-react";

type GroupRow = {
  id: string;
  name: string;
  regionId?: string | null;
  village?: string | null;
};

export interface GroupPickerProps {
  value: string;
  onChange: (groupId: string) => void;
  /** When set, only groups in this region (or descendants — see below) are shown.
   *  We pass the leaf region id; matching is exact. Pickers higher up in the
   *  tree won't filter — caller can pass empty string to disable filtering. */
  regionId?: string;
  testId?: string;
  placeholder?: string;
}

/**
 * Searchable single-select group picker. Replaces the previous flat <Select>
 * (and the truly painful "paste group UUID" TextInput on mobile). Filters by
 * `regionId` when provided so an agronomist drilling into Buwaya Parish only
 * sees the cooperatives based there.
 */
export function GroupPicker({
  value,
  onChange,
  regionId,
  testId = "group-picker",
  placeholder = "Select cooperative group",
}: GroupPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: groups, isLoading } = useListGroups({});

  const all = (groups ?? []) as unknown as GroupRow[];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(g => {
      // Strict region filter: when a region is chosen, only show groups whose
      // regionId is exactly that id. Groups with null/missing regionId never
      // belong to a specific region, so they are excluded too.
      if (regionId && g.regionId !== regionId) return false;
      if (!q) return true;
      return g.name.toLowerCase().includes(q) || (g.village ?? "").toLowerCase().includes(q);
    }).slice(0, 50);
  }, [all, query, regionId]);

  const selected = all.find(g => g.id === value);

  if (isLoading) return <Skeleton className="h-9 w-full" />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          data-testid={testId}
        >
          <span className={selected ? "" : "text-muted-foreground"}>
            {selected ? selected.name : placeholder}
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
              placeholder="Search by group or village…"
              className="pl-8 h-9"
              data-testid={`${testId}-search`}
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {regionId ? "No groups in this region yet." : "No groups found."}
            </div>
          ) : (
            filtered.map(g => (
              <button
                key={g.id}
                type="button"
                onClick={() => { onChange(g.id); setOpen(false); setQuery(""); }}
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-2"
                data-testid={`${testId}-option-${g.id}`}
              >
                <div className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{g.name}</span>
                  {g.village && <span className="text-xs text-muted-foreground truncate">{g.village}</span>}
                </div>
                {value === g.id && <Check className="h-4 w-4 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
