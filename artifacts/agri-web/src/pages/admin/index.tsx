import { useState, useMemo } from "react";
import { useListRegions, useListRoles, useListSyncQueue } from "@workspace/api-client-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, RefreshCw, MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Permission = { key: string; module: string; description: string };
type Role = { id: string; name: string; description?: string; permissions: string[]; isSystem?: boolean };

function PermissionPicker({
  catalog,
  selected,
  onChange,
}: {
  catalog: Permission[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of catalog) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [catalog]);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  return (
    <div className="max-h-[50vh] overflow-y-auto space-y-4 border rounded-md p-3">
      {grouped.map(([module, perms]) => (
        <div key={module}>
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">{module}</p>
          <div className="grid grid-cols-1 gap-2">
            {perms.map(p => (
              <div
                key={p.key}
                role="checkbox"
                aria-checked={selected.has(p.key)}
                aria-label={p.key}
                tabIndex={0}
                onClick={() => toggle(p.key)}
                onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(p.key); } }}
                className="flex items-start gap-2 text-sm cursor-pointer hover-elevate p-2 rounded"
                data-testid={`perm-${p.key}`}
              >
                <Checkbox checked={selected.has(p.key)} className="mt-0.5 pointer-events-none" tabIndex={-1} aria-hidden="true" />
                <div className="flex-1">
                  <code className="text-xs font-mono">{p.key}</code>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const { data: regions, isLoading: isLoadingRegions } = useListRegions();
  const { data: roles, isLoading: isLoadingRoles } = useListRoles();
  const { data: syncQueue, isLoading: isLoadingSyncQueue } = useListSyncQueue();
  const { data: permissions } = useQuery<Permission[]>({
    queryKey: ["/api/admin/permissions"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/permissions`);
      if (!r.ok) throw new Error(`Failed to load permissions (${r.status})`);
      return r.json();
    },
  });

  const { toast } = useToast();
  const qc = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", description: "" });
  const [createPerms, setCreatePerms] = useState<Set<string>>(new Set());

  const [editRole, setEditRole] = useState<Role | null>(null);
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());

  const [regionOpen, setRegionOpen] = useState(false);
  const [regionForm, setRegionForm] = useState({ name: "", level: "1", countryCode: "UG", parentId: "" });

  const createRegionMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/admin/regions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/regions"] });
      qc.invalidateQueries({ queryKey: ["listRegions"] });
      toast({ title: "Region created" });
      setRegionOpen(false);
      setRegionForm({ name: "", level: "1", countryCode: "UG", parentId: "" });
    },
    onError: (e: any) => toast({ title: "Failed to create region", description: e.message, variant: "destructive" }),
  });

  const submitRegion = () => {
    const name = regionForm.name.trim();
    const level = parseInt(regionForm.level, 10);
    if (!name) { toast({ title: "Region name required", variant: "destructive" }); return; }
    if (!Number.isFinite(level) || level < 1) { toast({ title: "Level must be a positive number", variant: "destructive" }); return; }
    const body: any = { name, level };
    if (regionForm.countryCode.trim()) body.countryCode = regionForm.countryCode.trim().toUpperCase();
    if (regionForm.parentId.trim()) body.parentId = regionForm.parentId.trim();
    createRegionMut.mutate(body);
  };

  const createMut = useMutation({
    mutationFn: (body: any) => fetch(`${API_BASE}/api/admin/roles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Role created" });
      setCreateOpen(false);
      setCreateForm({ name: "", description: "" });
      setCreatePerms(new Set());
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const editMut = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) =>
      fetch(`${API_BASE}/api/admin/roles/${id}/permissions`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permissions }) })
        .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Permissions updated" });
      setEditRole(null);
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => fetch(`${API_BASE}/api/admin/roles/${id}`, { method: "DELETE" })
      .then(async r => { if (!r.ok) throw new Error((await r.json()).error ?? "Failed"); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      toast({ title: "Role deleted" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submitCreate = () => {
    const name = createForm.name.trim();
    if (!name) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (createPerms.size === 0) { toast({ title: "Select at least one permission", variant: "destructive" }); return; }
    const body: any = { name, permissions: Array.from(createPerms) };
    if (createForm.description.trim()) body.description = createForm.description.trim();
    createMut.mutate(body);
  };

  const openEdit = (role: Role) => {
    setEditRole(role);
    setEditPerms(new Set(role.permissions ?? []));
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">System Administration</h1>
          <p className="text-muted-foreground mt-1">Regions, roles, and sync queue</p>
        </div>
      </div>

      <Tabs defaultValue="roles">
        <TabsList>
          <TabsTrigger value="regions">Regions</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; Permissions</TabsTrigger>
          <TabsTrigger value="sync">Sync Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="regions" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Regions</CardTitle>
              </div>
              <Dialog open={regionOpen} onOpenChange={(o) => { setRegionOpen(o); if (!o) setRegionForm({ name: "", level: "1", countryCode: "UG", parentId: "" }); }}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2" data-testid="new-region-btn"><Plus className="h-4 w-4" /> New Region</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Region</DialogTitle>
                    <DialogDescription>Regions are administrative units (e.g. district, sub-county). Use level 1 for top-level (district), 2 for sub-county, etc.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3">
                    <div><Label>Name *</Label><Input value={regionForm.name} onChange={e => setRegionForm({ ...regionForm, name: e.target.value })} placeholder="e.g. Mbale" data-testid="input-region-name" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label>Level *</Label><Input type="number" min="1" value={regionForm.level} onChange={e => setRegionForm({ ...regionForm, level: e.target.value })} data-testid="input-region-level" /></div>
                      <div><Label>Country code</Label><Input value={regionForm.countryCode} onChange={e => setRegionForm({ ...regionForm, countryCode: e.target.value })} placeholder="UG" data-testid="input-region-country" /></div>
                    </div>
                    <div><Label>Parent region ID (optional)</Label><Input value={regionForm.parentId} onChange={e => setRegionForm({ ...regionForm, parentId: e.target.value })} placeholder="parent region UUID" data-testid="input-region-parent" /></div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRegionOpen(false)}>Cancel</Button>
                    <Button onClick={submitRegion} disabled={createRegionMut.isPending} data-testid="submit-region-btn">{createRegionMut.isPending ? "Creating..." : "Create"}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Level</TableHead>
                    <TableHead>Country</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingRegions ? (
                    [1, 2].map(i => <TableRow key={i}><TableCell colSpan={3}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
                  ) : regions && regions.length > 0 ? regions.map((r: any) => (
                    <TableRow key={r.id} data-testid={`region-row-${r.id}`}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>{r.level}</TableCell>
                      <TableCell>{r.countryCode}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">No regions configured</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Role Permissions</CardTitle>
                <Dialog open={createOpen} onOpenChange={(o) => {
                  setCreateOpen(o);
                  if (!o) { setCreateForm({ name: "", description: "" }); setCreatePerms(new Set()); }
                }}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="gap-2" data-testid="new-role-btn"><Plus className="h-4 w-4" /> New Role</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Create New Role</DialogTitle>
                      <DialogDescription>Define a new role and pick the permissions it should grant.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                      <div><Label>Role Name *</Label><Input value={createForm.name} onChange={e => setCreateForm({ ...createForm, name: e.target.value })} placeholder="e.g. RegionalAuditor" data-testid="input-role-name" /></div>
                      <div><Label>Description</Label><Textarea value={createForm.description} onChange={e => setCreateForm({ ...createForm, description: e.target.value })} rows={2} placeholder="Short description of what this role does" data-testid="input-role-description" /></div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label>Permissions *</Label>
                          <span className="text-xs text-muted-foreground">{createPerms.size} selected</span>
                        </div>
                        {permissions ? <PermissionPicker catalog={permissions} selected={createPerms} onChange={setCreatePerms} /> : <Skeleton className="h-40 w-full" />}
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                      <Button onClick={submitCreate} disabled={createMut.isPending} data-testid="submit-role">{createMut.isPending ? "Saving..." : "Create Role"}</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingRoles ? <Skeleton className="h-40 w-full" /> : (
                <div className="space-y-3">
                  {roles && (roles as Role[]).map((role) => (
                    <div key={role.id} className="p-4 border rounded-lg" data-testid={`role-row-${role.id}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{role.name}</span>
                          {role.isSystem && <Badge variant="outline" className="text-xs">System</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{role.permissions?.length ?? 0} permissions</Badge>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(role)} data-testid={`edit-${role.id}`} title="Edit permissions"><Pencil className="h-4 w-4" /></Button>
                          {!role.isSystem && (
                            <Button size="sm" variant="ghost" onClick={() => { if (confirm(`Delete role "${role.name}"?`)) deleteMut.mutate(role.id); }} data-testid={`delete-${role.id}`} title="Delete role"><Trash2 className="h-4 w-4 text-red-600" /></Button>
                          )}
                        </div>
                      </div>
                      {role.description && <p className="text-sm text-muted-foreground mb-2">{role.description}</p>}
                      <div className="flex flex-wrap gap-1">
                        {role.permissions?.map((p) => (
                          <Badge key={p} variant="secondary" className="text-xs font-mono">{p}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sync" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Mobile Sync Queue</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoadingSyncQueue ? <Skeleton className="h-20 w-full" /> : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div><p className="text-xs text-muted-foreground">Pending Records</p><p className="text-2xl font-bold">{(syncQueue as any)?.pendingRecords ?? 0}</p></div>
                  <div><p className="text-xs text-muted-foreground">Failed Records</p><p className={`text-2xl font-bold ${((syncQueue as any)?.failedRecords ?? 0) > 0 ? "text-destructive" : ""}`}>{(syncQueue as any)?.failedRecords ?? 0}</p></div>
                  <div className="col-span-2"><p className="text-xs text-muted-foreground">Last Sync</p><p className="text-sm font-medium mt-1">{(syncQueue as any)?.lastSyncAt ? new Date((syncQueue as any).lastSyncAt).toLocaleString() : "—"}</p></div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!editRole} onOpenChange={(o) => !o && setEditRole(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Permissions — {editRole?.name}</DialogTitle>
            <DialogDescription>Toggle the permissions this role grants. {editRole?.isSystem ? "This is a system role; changes are still allowed." : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{editPerms.size} selected</span>
          </div>
          {permissions ? <PermissionPicker catalog={permissions} selected={editPerms} onChange={setEditPerms} /> : <Skeleton className="h-40 w-full" />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRole(null)}>Cancel</Button>
            <Button onClick={() => editRole && editMut.mutate({ id: editRole.id, permissions: Array.from(editPerms) })} disabled={editMut.isPending} data-testid="submit-edit-role">{editMut.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
