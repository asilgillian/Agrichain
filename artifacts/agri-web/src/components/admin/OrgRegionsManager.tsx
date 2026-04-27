import { useState, useMemo, type ReactElement } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListRegions, useListCountryHierarchies } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Layers, AlertCircle } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Region = {
  id: string;
  name: string;
  parentId?: string | null;
  level: number;
  countryCode?: string;
  isActive?: boolean;
};

type OrgRegion = {
  id: string;
  name: string;
  description?: string | null;
  countryCode: string;
  isActive: boolean;
  districtCount?: number;
};

type OrgRegionDetail = OrgRegion & {
  districts: Array<{ id: string; name: string; level: number; countryCode: string }>;
};

type Hierarchy = {
  countryCode: string;
  countryName: string;
  levels: Array<{ level: number; name: string }>;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch {}
    throw new Error(`${res.status} ${res.statusText}: ${body.slice(0, 240)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Determine the "District" level number for the given country, used to filter
 * the region tree down to district-only rows for the picker. Falls back to
 * level 1 if the hierarchy doesn't name a "district" level explicitly — same
 * convention as the server-side helper.
 */
function getDistrictLevel(countryCode: string, hierarchies: Hierarchy[] | undefined): number {
  const hier = hierarchies?.find((h) => h.countryCode === countryCode);
  const match = hier?.levels.find((l) => /^district$/i.test(l.name));
  return match?.level ?? 1;
}

export function OrgRegionsManager(): ReactElement {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: regions } = useListRegions();
  const { data: hierarchies } = useListCountryHierarchies();

  const { data: orgRegions, isLoading } = useQuery<OrgRegion[]>({
    queryKey: ["/api/org-regions"],
    queryFn: () => api<OrgRegion[]>("/api/org-regions"),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrgRegion | null>(null);
  const [districtsFor, setDistrictsFor] = useState<OrgRegion | null>(null);

  const createMut = useMutation({
    mutationFn: (body: { name: string; description: string; countryCode: string }) =>
      api<OrgRegion>("/api/admin/org-regions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/org-regions"] });
      setCreateOpen(false);
      toast({ title: "Region created" });
    },
    onError: (e: Error) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<OrgRegion>(`/api/admin/org-regions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/org-regions"] });
      setEditing(null);
      toast({ title: "Region updated" });
    },
    onError: (e: Error) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/admin/org-regions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/org-regions"] });
      toast({ title: "Region deleted" });
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Organisational Regions
          </CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Cluster country districts into your own regions. Field forms (mobile preregister, etc.)
            present these as the first dropdown so agents pick a region, then a group, then a village.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="org-region-create-trigger">
              <Plus className="h-4 w-4 mr-1" /> New
            </Button>
          </DialogTrigger>
          <CreateOrEditDialog
            mode="create"
            hierarchies={hierarchies as Hierarchy[] | undefined}
            onSubmit={(b) => createMut.mutate(b as { name: string; description: string; countryCode: string })}
            submitting={createMut.isPending}
          />
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (orgRegions ?? []).length === 0 ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2 py-6">
            <AlertCircle className="h-4 w-4" />
            No organisational regions yet. Create one to enable the 3-dropdown form flow on mobile.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Districts</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-48">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgRegions!.map((r) => (
                <TableRow key={r.id} data-testid={`org-region-row-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{r.countryCode}</Badge></TableCell>
                  <TableCell><Badge variant="secondary">{r.districtCount ?? 0}</Badge></TableCell>
                  <TableCell>{r.isActive ? <Badge>Active</Badge> : <Badge variant="outline">Inactive</Badge>}</TableCell>
                  <TableCell className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDistrictsFor(r)} data-testid={`org-region-districts-${r.id}`}>
                      <Layers className="h-3 w-3 mr-1" /> Districts
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} data-testid={`org-region-edit-${r.id}`}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm(`Delete org region "${r.name}"? This will not delete the country districts themselves.`)) {
                          deleteMut.mutate(r.id);
                        }
                      }}
                      data-testid={`org-region-delete-${r.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <CreateOrEditDialog
            mode="edit"
            initial={editing}
            hierarchies={hierarchies as Hierarchy[] | undefined}
            onSubmit={(b) => editMut.mutate({ id: editing.id, body: b })}
            submitting={editMut.isPending}
          />
        )}
      </Dialog>

      {/* Districts dialog */}
      <Dialog open={!!districtsFor} onOpenChange={(o) => !o && setDistrictsFor(null)}>
        {districtsFor && (
          <DistrictsDialog
            orgRegion={districtsFor}
            allRegions={(regions ?? []) as Region[]}
            districtLevel={getDistrictLevel(districtsFor.countryCode, hierarchies as Hierarchy[] | undefined)}
            onClose={() => setDistrictsFor(null)}
            onSaved={() => qc.invalidateQueries({ queryKey: ["/api/org-regions"] })}
          />
        )}
      </Dialog>
    </Card>
  );
}

function CreateOrEditDialog({
  mode,
  initial,
  hierarchies,
  onSubmit,
  submitting,
}: {
  mode: "create" | "edit";
  initial?: OrgRegion;
  hierarchies?: Hierarchy[];
  onSubmit: (body: { name?: string; description?: string; countryCode?: string; isActive?: boolean }) => void;
  submitting: boolean;
}): ReactElement {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [countryCode, setCountryCode] = useState(initial?.countryCode ?? "UG");
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "New organisational region" : "Edit region"}</DialogTitle>
        <DialogDescription>
          A custom cluster of country districts (e.g. "Eastern Uganda", "Coffee Belt").
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="org-region-name" />
        </div>
        <div>
          <Label>Description</Label>
          <Textarea value={description ?? ""} onChange={(e) => setDescription(e.target.value)} data-testid="org-region-desc" />
        </div>
        <div>
          <Label>Country</Label>
          <Select value={countryCode} onValueChange={setCountryCode}>
            <SelectTrigger data-testid="org-region-country"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(hierarchies ?? []).map((h) => (
                <SelectItem key={h.countryCode} value={h.countryCode}>
                  {h.countryName} ({h.countryCode})
                </SelectItem>
              ))}
              {(!hierarchies || hierarchies.length === 0) && <SelectItem value="UG">Uganda (UG)</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        {mode === "edit" && (
          <div className="flex items-center gap-2">
            <Switch checked={isActive} onCheckedChange={setIsActive} id="org-region-active" />
            <Label htmlFor="org-region-active">Active</Label>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button
          onClick={() => {
            const body: Record<string, unknown> = {};
            if (name.trim()) body.name = name.trim();
            body.description = description?.trim() ?? "";
            if (mode === "create") body.countryCode = countryCode;
            if (mode === "edit") body.isActive = isActive;
            onSubmit(body);
          }}
          disabled={submitting || !name.trim()}
          data-testid="org-region-save"
        >
          {submitting ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DistrictsDialog({
  orgRegion,
  allRegions,
  districtLevel,
  onClose,
  onSaved,
}: {
  orgRegion: OrgRegion;
  allRegions: Region[];
  districtLevel: number;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery<OrgRegionDetail>({
    queryKey: ["/api/org-regions", orgRegion.id],
    queryFn: () => api<OrgRegionDetail>(`/api/org-regions/${orgRegion.id}`),
  });

  const candidates = useMemo(
    () =>
      allRegions
        .filter((r) => r.countryCode === orgRegion.countryCode && r.level === districtLevel && r.isActive !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allRegions, orgRegion.countryCode, districtLevel],
  );

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [initialised, setInitialised] = useState(false);
  const [filter, setFilter] = useState("");

  if (detail && !initialised) {
    setPicked(new Set(detail.districts.map((d) => d.id)));
    setInitialised(true);
  }

  const filtered = useMemo(
    () => candidates.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase())),
    [candidates, filter],
  );

  const saveMut = useMutation({
    mutationFn: () =>
      api(`/api/admin/org-regions/${orgRegion.id}/districts`, {
        method: "PUT",
        body: JSON.stringify({ districtIds: Array.from(picked) }),
      }),
    onSuccess: () => {
      toast({ title: "Districts updated" });
      qc.invalidateQueries({ queryKey: ["/api/org-regions"] });
      qc.invalidateQueries({ queryKey: ["/api/org-regions", orgRegion.id] });
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Districts in "{orgRegion.name}"</DialogTitle>
        <DialogDescription>
          Pick which {orgRegion.countryCode} districts belong to this region. Field-form pickers will
          show all groups and villages whose tree sits under one of these districts.
        </DialogDescription>
      </DialogHeader>
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <Input
            placeholder="Filter districts…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2"
            data-testid="districts-filter"
          />
          <div className="max-h-80 overflow-y-auto border rounded-md p-2 space-y-1">
            {candidates.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4">
                No districts found for {orgRegion.countryCode}. Add district rows in the Regions tab first.
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4">No matches.</div>
            ) : (
              filtered.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1 hover:bg-accent rounded cursor-pointer">
                  <Checkbox
                    checked={picked.has(c.id)}
                    onCheckedChange={(v) => {
                      const next = new Set(picked);
                      if (v) next.add(c.id);
                      else next.delete(c.id);
                      setPicked(next);
                    }}
                    data-testid={`district-pick-${c.id}`}
                  />
                  <span className="text-sm">{c.name}</span>
                </label>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {picked.size} selected · {candidates.length} total
          </p>
        </>
      )}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} data-testid="districts-save">
          {saveMut.isPending ? "Saving…" : "Save districts"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
