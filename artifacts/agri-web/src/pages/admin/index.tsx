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
import { Settings, RefreshCw, MapPin, Plus, Pencil, Trash2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

  const [bulkEntity, setBulkEntity] = useState<"regions" | "farmers" | "groups">("regions");
  const [bulkRows, setBulkRows] = useState<Record<string, any>[]>([]);
  const [bulkFileName, setBulkFileName] = useState<string>("");
  const [bulkResult, setBulkResult] = useState<any | null>(null);

  const BULK_TEMPLATES: Record<string, { headers: string[]; example: string; notes: string }> = {
    regions: {
      headers: ["name", "level", "countryCode", "parentId"],
      example: "Mbale,1,UG,\nMbale Municipality,2,UG,<parent-region-uuid>",
      notes: "name and level are required. countryCode defaults to UG when blank. parentId is the UUID of the parent region (leave blank for top-level).",
    },
    groups: {
      headers: ["name", "regionId", "village"],
      example: "Buwasa Coffee Coop,<region-uuid>,Buwasa\nNorth Mbale Producers,<region-uuid>,",
      notes: "name and regionId are required. regionId must be the UUID of an existing region.",
    },
    farmers: {
      headers: ["firstName", "lastName", "nationalId", "phoneNumber", "sex", "groupId", "regionId", "village", "dateOfBirth"],
      example: "John,Wanyama,CM12345678,+256770000001,male,<group-uuid>,<region-uuid>,Buwasa,1985-04-12",
      notes: "firstName, lastName, nationalId, groupId and regionId are required. sex is one of male/female/other. dateOfBirth in YYYY-MM-DD.",
    },
  };

  function parseCsv(text: string): Record<string, any>[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];
    const splitLine = (l: string): string[] => {
      const out: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i];
        if (ch === '"') {
          if (inQuotes && l[i + 1] === '"') { cur += '"'; i++; }
          else inQuotes = !inQuotes;
        } else if (ch === "," && !inQuotes) {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    };
    const headers = splitLine(lines[0]);
    return lines.slice(1).map(l => {
      const cells = splitLine(l);
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => {
        const v = cells[i];
        if (v != null && v !== "") {
          if (h === "level") obj[h] = Number(v);
          else obj[h] = v;
        }
      });
      return obj;
    });
  }

  const handleBulkFile = async (file: File) => {
    setBulkResult(null);
    setBulkFileName(file.name);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      setBulkRows(rows);
      if (rows.length === 0) toast({ title: "No rows found in file", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Failed to parse CSV", description: e.message, variant: "destructive" });
    }
  };

  const bulkUploadMut = useMutation({
    mutationFn: () => fetch(`${API_BASE}/api/admin/bulk-upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: bulkEntity, rows: bulkRows }),
    }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Upload failed"); return j; }),
    onSuccess: (data) => {
      setBulkResult(data);
      qc.invalidateQueries({ queryKey: ["/api/admin/regions"] });
      qc.invalidateQueries({ queryKey: ["listRegions"] });
      qc.invalidateQueries({ queryKey: ["listFarmers"] });
      qc.invalidateQueries({ queryKey: ["listGroups"] });
      toast({
        title: `Uploaded: ${data.createdCount} created, ${data.errorCount} failed`,
        variant: data.errorCount > 0 ? "destructive" : "default",
      });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  const downloadTemplate = () => {
    const t = BULK_TEMPLATES[bulkEntity];
    const csv = `${t.headers.join(",")}\n${t.example}\n`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bulkEntity}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
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

        <TabsContent value="bulk" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Bulk Upload Master Data</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground mt-1">Upload up to 1,000 records at a time from a CSV file. Each row is validated; valid rows are inserted and invalid rows are reported back with their error.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Entity type</Label>
                  <Select value={bulkEntity} onValueChange={(v) => { setBulkEntity(v as any); setBulkRows([]); setBulkFileName(""); setBulkResult(null); }}>
                    <SelectTrigger data-testid="bulk-entity-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="regions">Regions</SelectItem>
                      <SelectItem value="groups">Farmer Groups</SelectItem>
                      <SelectItem value="farmers">Farmers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2">
                  <Label>CSV file</Label>
                  <Input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleBulkFile(f); }}
                    data-testid="bulk-file-input"
                  />
                </div>
              </div>

              <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Expected columns: <code className="font-mono">{BULK_TEMPLATES[bulkEntity].headers.join(", ")}</code></span>
                  <Button size="sm" variant="outline" className="gap-1" onClick={downloadTemplate} data-testid="download-template-btn">
                    <FileSpreadsheet className="h-3 w-3" /> Template
                  </Button>
                </div>
                <p className="text-muted-foreground">{BULK_TEMPLATES[bulkEntity].notes}</p>
              </div>

              {bulkRows.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm"><strong>{bulkFileName}</strong> — {bulkRows.length} row{bulkRows.length === 1 ? "" : "s"} parsed (showing first 5)</p>
                    <Button onClick={() => bulkUploadMut.mutate()} disabled={bulkUploadMut.isPending} data-testid="bulk-submit-btn" className="gap-2">
                      <Upload className="h-4 w-4" />{bulkUploadMut.isPending ? "Uploading..." : `Upload ${bulkRows.length} rows`}
                    </Button>
                  </div>
                  <div className="border rounded-md overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {BULK_TEMPLATES[bulkEntity].headers.map(h => <TableHead key={h}>{h}</TableHead>)}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bulkRows.slice(0, 5).map((r, i) => (
                          <TableRow key={i}>
                            {BULK_TEMPLATES[bulkEntity].headers.map(h => (
                              <TableCell key={h} className="font-mono text-xs">{r[h] != null ? String(r[h]) : <span className="text-muted-foreground">—</span>}</TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}

              {bulkResult && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />{bulkResult.createdCount} created</Badge>
                    {bulkResult.errorCount > 0 && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" />{bulkResult.errorCount} failed</Badge>}
                    <span className="text-xs text-muted-foreground">of {bulkResult.totalSubmitted} submitted</span>
                  </div>
                  {bulkResult.errors?.length > 0 && (
                    <div className="border border-destructive/30 rounded-md max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16">Row</TableHead>
                            <TableHead>Error</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bulkResult.errors.map((e: any) => (
                            <TableRow key={e.row} data-testid={`bulk-error-${e.row}`}>
                              <TableCell className="font-mono">{e.row}</TableCell>
                              <TableCell className="text-xs text-destructive">{e.error}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
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
