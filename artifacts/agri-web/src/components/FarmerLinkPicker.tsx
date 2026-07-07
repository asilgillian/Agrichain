import { useState } from "react";
import { useListFarmers, getListFarmersQueryKey, type Farmer } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown, X, User } from "lucide-react";
import { cn } from "@/lib/utils";

function farmerLabel(f: Pick<Farmer, "firstName" | "lastName" | "referenceNumber">): string {
  const name = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  return name ? `${name} · ${f.referenceNumber}` : f.referenceNumber;
}

type Props = {
  value: string;
  /** Label to show for the currently-linked farmer (when not in the search results). */
  currentLabel?: string;
  onChange: (next: { farmerId: string; label: string }) => void;
  disabled?: boolean;
};

export function FarmerLinkPicker({ value, currentLabel, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const listParams = { ...(search.trim() ? { search: search.trim() } : {}), limit: 20 };
  const { data, isLoading } = useListFarmers(listParams, {
    query: { enabled: open, queryKey: getListFarmersQueryKey(listParams) },
  });
  const farmers = data?.data ?? [];

  const selectedInList = farmers.find((f) => f.id === value);
  const triggerLabel = value
    ? (selectedInList ? farmerLabel(selectedInList) : (currentLabel || "Linked farmer"))
    : "No linked farmer";

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="flex-1 justify-between font-normal"
            data-testid="supplier-farmer-link-trigger"
          >
            <span className={cn("flex items-center gap-2 truncate", !value && "text-muted-foreground")}>
              <User className="h-4 w-4 shrink-0" />
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Search farmers by name, ref, ID…" value={search} onValueChange={setSearch} />
            <CommandList>
              {isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
              ) : (
                <>
                  <CommandEmpty>No farmers found.</CommandEmpty>
                  <CommandGroup>
                    {farmers.map((f) => (
                      <CommandItem
                        key={f.id}
                        value={f.id}
                        onSelect={() => {
                          onChange({ farmerId: f.id, label: farmerLabel(f) });
                          setOpen(false);
                        }}
                        data-testid={`supplier-farmer-option-${f.id}`}
                      >
                        <Check className={cn("mr-2 h-4 w-4", value === f.id ? "opacity-100" : "opacity-0")} />
                        {farmerLabel(f)}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onChange({ farmerId: "", label: "" })}
          title="Clear link"
          data-testid="supplier-farmer-link-clear"
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
