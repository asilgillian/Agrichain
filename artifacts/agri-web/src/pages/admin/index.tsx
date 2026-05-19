import { useState, useMemo, Fragment } from "react";
import { useListRegions, useListRoles, useListSyncQueue, useListCountryHierarchies } from "@workspace/api-client-react";
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
import { Settings, RefreshCw, MapPin, Plus, Pencil, Trash2, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Globe2, ArrowUp, ArrowDown, Save } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RegionsManager } from "@/components/admin/RegionsManager";
import { RegionsMap } from "@/components/admin/RegionsMap";
import { OrgRegionsManager } from "@/components/admin/OrgRegionsManager";
import { RegistrationTemplatesManager } from "@/components/admin/RegistrationTemplatesManager";
import { TransactionAccessManager } from "@/components/admin/TransactionAccessManager";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Permission = { key: string; module: string; description: string };
type Role = { id: string; name: string; description?: string; permissions: string[]; isSystem?: boolean };
type PermissionTemplate = { name: string; description: string; permissions: string[] };

// Helper rendered inside both the Create and Edit dialogs. The template list is fetched once
// at the page level and passed in. Selecting a template REPLACES the current selection — this
// matches the spec ("pre-fill") and avoids surprising additive behavior; the admin can then
// freely tick or untick individual permissions before saving.
function TemplatePicker({
  templates,
  onApply,
}: {
  templates: PermissionTemplate[] | undefined;
  onApply: (perms: string[]) => void;
}) {
  if (!templates || templates.length === 0) return null;
  return (
    <div className="flex items-center gap-2 mb-2">
      <Label className="text-xs whitespace-nowrap">Apply template</Label>
      <Select value="" onValueChange={(name) => {
        const t = templates.find(t => t.name === name);
        if (t) onApply(t.permissions);
      }}>
        <SelectTrigger className="h-8 w-64" data-testid="template-picker">
          <SelectValue placeholder="Choose a starting template…" />
        </SelectTrigger>
        <SelectContent>
          {templates.map(t => (
            <SelectItem key={t.name} value={t.name} data-testid={`template-${t.name.replace(/\s+/g, "-").toLowerCase()}`}>
              <div className="flex flex-col">
                <span className="font-medium">{t.name}</span>
                <span className="text-xs text-muted-foreground">{t.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

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
  const { data: templates } = useQuery<PermissionTemplate[]>({
    queryKey: ["/api/admin/permission-templates"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/permission-templates`);
      if (!r.ok) throw new Error(`Failed to load permission templates (${r.status})`);
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

  type BulkEntityKey =
    | "regions"
    | "farmers"
    | "groups"
    | "org_regions"
    | "commodities"
    | "commodity_types"
    | "commodity_prices"
    | "buying_stations"
    | "silos"
    | "storage_bins"
    | "users";

  const [bulkEntity, setBulkEntity] = useState<BulkEntityKey>("regions");
  const [bulkRows, setBulkRows] = useState<Record<string, any>[]>([]);
  const [bulkFileName, setBulkFileName] = useState<string>("");
  const [bulkResult, setBulkResult] = useState<any | null>(null);

  const BULK_TEMPLATES: Record<BulkEntityKey, { label: string; headers: string[]; example: string; notes: string }> = {
    regions: {
      label: "Regions (admin units)",
      headers: ["name", "level", "countryCode", "parentId"],
      example: "Mbale,1,UG,\nMbale Municipality,2,UG,<parent-region-uuid>",
      notes: "name and level are required. countryCode defaults to UG when blank. parentId is the UUID of the parent region (leave blank for top-level).",
    },
    org_regions: {
      label: "Org Regions (operational clusters)",
      headers: ["name", "description", "countryCode", "isActive"],
      example: "Eastern Uganda,Mbale + Bugisu sub-region,UG,true\nNorthern Uganda,Acholi + Lango,UG,true",
      notes: "name is required. countryCode defaults to UG. isActive accepts true/false (default true). District-membership rows must be assigned afterwards from the Org Regions screen.",
    },
    groups: {
      label: "Farmer Groups",
      headers: ["name", "regionId", "village"],
      example: "Buwasa Coffee Coop,<region-uuid>,Buwasa\nNorth Mbale Producers,<region-uuid>,",
      notes: "name and regionId are required. regionId must be the UUID of an existing region.",
    },
    farmers: {
      label: "Farmers",
      headers: ["firstName", "lastName", "nationalId", "phoneNumber", "sex", "groupId", "regionId", "village", "dateOfBirth"],
      example: "John,Wanyama,CM12345678,+256770000001,male,<group-uuid>,<region-uuid>,Buwasa,1985-04-12",
      notes: "firstName, lastName, nationalId, groupId and regionId are required. sex is one of male/female/other. dateOfBirth in YYYY-MM-DD.",
    },
    commodities: {
      label: "Commodities (master catalog)",
      headers: ["name", "code", "scientificName", "defaultUnit", "description", "status"],
      example: "Coffee,COFFEE,Coffea spp.,kg,Arabica and Robusta coffee,active\nMaize,MAIZE,Zea mays,kg,White and yellow maize,active",
      notes: "name and code are required. code must be unique. defaultUnit defaults to kg, status defaults to active.",
    },
    commodity_types: {
      label: "Commodity Types (variants / stages)",
      headers: ["commodityId", "name", "code", "stage", "parentCommodityTypeId", "isPurchasable", "isSellable", "defaultUnit", "defaultMoistureMin", "defaultMoistureMax", "status"],
      example: "<commodity-uuid>,Robusta Cherry,ROB_CHERRY,raw,,true,false,kg,30,60,active\n<commodity-uuid>,Robusta Parchment,ROB_PARCH,intermediate,<parent-type-uuid>,true,true,kg,11,13,active",
      notes: "commodityId, name and code are required. stage is one of raw/intermediate/finished (default raw). parentCommodityTypeId is the previous-stage type UUID (blank for raw).",
    },
    commodity_prices: {
      label: "Commodity Prices (daily price-per-kg)",
      headers: ["commodityTypeId", "regionId", "pricePerKg", "currency", "effectiveDate", "source", "notes"],
      example: "<commodity-type-uuid>,,8500,UGX,2026-05-19,manual,Opening price\n<commodity-type-uuid>,<region-uuid>,8700,UGX,2026-05-19,market,Regional override",
      notes: "commodityTypeId, pricePerKg and effectiveDate (YYYY-MM-DD) are required. regionId optional (blank = nationwide). currency defaults to UGX, source defaults to manual.",
    },
    buying_stations: {
      label: "Buying Stations",
      headers: ["name", "location", "gpsLat", "gpsLng", "managerUserId", "isActive"],
      example: "Buwasa BS,Buwasa Trading Centre,1.0234,34.5678,<user-uuid>,true\nManafwa BS,Manafwa Town,,,,true",
      notes: "name is required. gpsLat/gpsLng are decimal degrees. managerUserId is the UUID of the assigned staff user.",
    },
    silos: {
      label: "Silos (bulk warehouse)",
      headers: ["name", "facilityId", "stream", "commodityType", "capacityKg", "status"],
      example: "Silo A1,MBALE-WH-01,maize,Maize,500000,ACTIVE\nSilo A2,MBALE-WH-01,maize,Maize,500000,ACTIVE",
      notes: "name and stream are required. status is one of ACTIVE/IDLE/CLEANING/MAINTENANCE (default ACTIVE).",
    },
    storage_bins: {
      label: "Storage Bins (bagged warehouse)",
      headers: ["name", "facilityId", "stream", "commodityType", "capacityKg", "isActive"],
      example: "Bin B1,MBALE-WH-01,coffee,Robusta Parchment,40000,true\nBin B2,MBALE-WH-01,coffee,Robusta Parchment,40000,true",
      notes: "name and stream are required. capacityKg is the bagged-stock capacity in kg.",
    },
    users: {
      label: "Users (staff)",
      headers: ["firstName", "lastName", "email", "phoneNumber", "clerkUserId", "role", "regionId", "managerId", "status"],
      example: "Pauline,Asil,paulineasil@gmail.com,+256770000001,,SystemAdministrator,,,active\nJohn,Field,john.field@mtandeo.co.ug,+256770000002,,FieldAgent,<region-uuid>,<manager-uuid>,active",
      notes: "firstName, lastName, email and role are required. email must be unique. Leave clerkUserId blank — it is populated automatically on first Google/email sign-in. status defaults to active.",
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
          <TabsTrigger value="org-regions">Org Regions</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="hierarchy">Country Hierarchy</TabsTrigger>
          <TabsTrigger value="roles">Roles &amp; Permissions</TabsTrigger>
          <TabsTrigger value="matrix">Permission Matrix</TabsTrigger>
          <TabsTrigger value="bulk">Bulk Upload</TabsTrigger>
          <TabsTrigger value="registration-templates">Registration Templates</TabsTrigger>
          <TabsTrigger value="transaction-access">Transaction Access</TabsTrigger>
          <TabsTrigger value="sync">Sync Queue</TabsTrigger>
        </TabsList>

        <TabsContent value="regions" className="mt-4">
          <RegionsManager />
        </TabsContent>

        <TabsContent value="org-regions" className="mt-4">
          <OrgRegionsManager />
        </TabsContent>

        <TabsContent value="map" className="mt-4">
          <RegionsMap />
        </TabsContent>

        <TabsContent value="hierarchy" className="mt-4">
          <CountryHierarchyEditor />
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
                  <Select value={bulkEntity} onValueChange={(v) => { setBulkEntity(v as BulkEntityKey); setBulkRows([]); setBulkFileName(""); setBulkResult(null); }}>
                    <SelectTrigger data-testid="bulk-entity-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(BULK_TEMPLATES) as BulkEntityKey[]).map((k) => (
                        <SelectItem key={k} value={k}>{BULK_TEMPLATES[k].label}</SelectItem>
                      ))}
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
                        <TemplatePicker templates={templates} onApply={(perms) => setCreatePerms(new Set(perms))} />
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

        <TabsContent value="matrix" className="mt-4">
          <PermissionMatrix
            roles={(roles ?? []) as Role[]}
            permissions={permissions ?? []}
            isLoading={isLoadingRoles || !permissions}
          />
        </TabsContent>

        <TabsContent value="registration-templates" className="mt-4">
          <RegistrationTemplatesManager />
        </TabsContent>

        <TabsContent value="transaction-access" className="mt-4">
          <TransactionAccessManager />
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
          <TemplatePicker templates={templates} onApply={(perms) => setEditPerms(new Set(perms))} />
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

// PermissionMatrix renders a permissions × roles grid with checkboxes. The admin can flip
// many cells across many roles, then "Save changes" issues one PATCH per modified role
// (sequentially, so the toast only fires when everything succeeds). System roles (e.g.
// SystemAdministrator) are shown with their permissions but rendered read-only since they
// hold the wildcard "*" permission and editing them would just be misleading.
function PermissionMatrix({
  roles,
  permissions,
  isLoading,
}: {
  roles: Role[];
  permissions: Permission[];
  isLoading: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // The matrix keeps a local working copy of permissions per role. Reset whenever the upstream
  // roles change so we always start from the current server state and never silently overwrite
  // a permission an admin set in the role edit dialog in another tab.
  const initialMatrix = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const r of roles) m[r.id] = new Set(r.permissions ?? []);
    return m;
  }, [roles]);
  const [matrix, setMatrix] = useState<Record<string, Set<string>>>(initialMatrix);
  // Reset local state whenever the upstream roles prop changes (e.g. after a save invalidation
  // refetches). We compare via a stable serialization to avoid re-resetting on every render.
  const upstreamKey = useMemo(() => JSON.stringify(roles.map(r => [r.id, [...(r.permissions ?? [])].sort()])), [roles]);
  const [seenKey, setSeenKey] = useState(upstreamKey);
  if (seenKey !== upstreamKey) {
    setSeenKey(upstreamKey);
    setMatrix(initialMatrix);
  }

  const groupedPerms = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of permissions) {
      if (!map.has(p.module)) map.set(p.module, []);
      map.get(p.module)!.push(p);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [permissions]);

  const isWildcardRole = (r: Role) => (r.permissions ?? []).includes("*");

  const toggle = (roleId: string, key: string) => {
    setMatrix(prev => {
      const next = { ...prev };
      const set = new Set(next[roleId] ?? []);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      next[roleId] = set;
      return next;
    });
  };

  // Compute which roles have actually changed compared to the upstream snapshot. We compare
  // sets element-wise so iteration order doesn't produce false-positive "dirty" states.
  const changedRoleIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of roles) {
      const before = new Set(r.permissions ?? []);
      const after = matrix[r.id] ?? new Set<string>();
      if (before.size !== after.size) { ids.push(r.id); continue; }
      let same = true;
      for (const k of after) if (!before.has(k)) { same = false; break; }
      if (!same) ids.push(r.id);
    }
    return ids;
  }, [roles, matrix]);

  const saveMut = useMutation({
    mutationFn: async () => {
      // Send sequentially so a partial failure doesn't leave a confusing mix of saved/unsaved
      // states across roles. Throw on the first error and report the role name in the toast.
      for (const id of changedRoleIds) {
        const role = roles.find(r => r.id === id);
        if (!role) continue;
        if (isWildcardRole(role)) continue; // safety: never PATCH a wildcard role from the matrix
        const perms = Array.from(matrix[id] ?? []);
        const r = await fetch(`${API_BASE}/api/admin/roles/${id}/permissions`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ permissions: perms }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(`${role.name}: ${j.error ?? `HTTP ${r.status}`}`);
        }
      }
      return { savedCount: changedRoleIds.length };
    },
    onSuccess: ({ savedCount }) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/roles"] });
      qc.invalidateQueries({ queryKey: ["listRoles"] });
      toast({ title: `Saved permissions for ${savedCount} role${savedCount === 1 ? "" : "s"}` });
    },
    onError: (e: any) => toast({ title: "Failed to save matrix", description: e.message, variant: "destructive" }),
  });

  const reset = () => setMatrix(initialMatrix);

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (roles.length === 0 || permissions.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No roles or permissions to display.</CardContent></Card>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Permission Matrix</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Each row is a permission; each column is a role. Tick to grant, untick to revoke. Wildcard roles (with the "*" permission, e.g. SystemAdministrator) are read-only here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {changedRoleIds.length > 0 && <Badge variant="secondary" data-testid="matrix-dirty-badge">{changedRoleIds.length} role{changedRoleIds.length === 1 ? "" : "s"} changed</Badge>}
            <Button variant="outline" disabled={changedRoleIds.length === 0 || saveMut.isPending} onClick={reset} data-testid="matrix-reset-btn">Reset</Button>
            <Button disabled={changedRoleIds.length === 0 || saveMut.isPending} onClick={() => saveMut.mutate()} data-testid="matrix-save-btn" className="gap-2">
              <Save className="h-4 w-4" />{saveMut.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/*
          Why a raw <table> instead of shadcn <Table>:
          The shadcn Table primitive wraps itself in `<div class="relative w-full overflow-auto">`,
          which becomes the scroll container. Sticky positioning is relative to the nearest
          scroll ancestor, so a sticky header inside that wrapper would still scroll out of
          view if the user scrolled the OUTER container we put around it. By owning the
          single scroll div here, the role-name header stays pinned to the top while scrolling
          permission rows, and the "Permission" column stays pinned to the left while
          scrolling roles horizontally.
        */}
        <div
          className="border rounded-md overflow-auto max-h-[70vh] relative"
          data-testid="matrix-scroll-container"
        >
          <table className="w-full caption-bottom text-sm border-collapse">
            <thead>
              <tr className="border-b">
                <th
                  className="sticky top-0 left-0 z-30 bg-background border-b border-r p-3 text-left w-[280px] min-w-[280px] font-medium"
                  scope="col"
                >
                  Permission
                </th>
                {roles.map(r => (
                  <th
                    key={r.id}
                    scope="col"
                    className="sticky top-0 z-20 bg-background border-b border-r last:border-r-0 p-3 text-center min-w-[140px] font-medium"
                  >
                    <div className="flex flex-col items-center">
                      <span className="font-semibold whitespace-nowrap">{r.name}</span>
                      {isWildcardRole(r) && <Badge variant="outline" className="text-[10px] mt-1">wildcard</Badge>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedPerms.map(([module, perms]) => (
                <Fragment key={`module-${module}`}>
                  <tr className="bg-muted/60">
                    {/*
                      Module band: a single sticky-left cell whose VISUAL width via min-w covers
                      the visible viewport, then a transparent spacer cell that spans the rest
                      of the columns so the row's background still extends. This lets the module
                      label stay visible at the start of the row even when scrolled horizontally.
                    */}
                    <th
                      scope="rowgroup"
                      className="sticky left-0 z-10 bg-muted/60 p-2 text-xs font-semibold uppercase text-muted-foreground text-left w-[280px] min-w-[280px] border-b"
                    >
                      {module}
                    </th>
                    <td colSpan={roles.length} className="bg-muted/60 border-b" />
                  </tr>
                  {perms.map(p => (
                    <tr key={p.key} data-testid={`matrix-row-${p.key}`} className="border-b last:border-b-0 hover:bg-muted/20">
                      <th
                        scope="row"
                        className="sticky left-0 z-10 bg-background border-r p-3 text-left w-[280px] min-w-[280px] font-normal align-top"
                      >
                        <code className="text-xs font-mono">{p.key}</code>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                      </th>
                      {roles.map(r => {
                        const wildcard = isWildcardRole(r);
                        // Wildcard roles always show as ticked (since "*" implies everything) but disabled.
                        const checked = wildcard ? true : (matrix[r.id]?.has(p.key) ?? false);
                        const original = (r.permissions ?? []).includes(p.key) || wildcard;
                        const changed = !wildcard && checked !== original;
                        return (
                          <td key={r.id} className="text-center p-2 border-r last:border-r-0 align-middle">
                            <div
                              className={`inline-flex items-center justify-center rounded p-1 ${changed ? "bg-amber-100 dark:bg-amber-950" : ""}`}
                              data-testid={`matrix-cell-${p.key}-${r.id}`}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={wildcard}
                                onCheckedChange={() => !wildcard && toggle(r.id, p.key)}
                                aria-label={`${p.key} for ${r.name}`}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Scroll horizontally to see more roles. The role names stay pinned at the top and the permission column stays pinned to the left.
        </p>
      </CardContent>
    </Card>
  );
}

type HierarchyRow = { countryCode: string; countryName: string; levels: { level: number; name: string }[]; updatedAt?: string };

function CountryHierarchyEditor() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: hierarchies, isLoading } = useListCountryHierarchies();
  const list = (hierarchies ?? []) as HierarchyRow[];

  const [selectedCode, setSelectedCode] = useState<string>("");
  const [draft, setDraft] = useState<HierarchyRow | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  const activeCode = selectedCode || list[0]?.countryCode || "";
  const active = list.find(h => h.countryCode === activeCode);

  const current: HierarchyRow | null = draft && draft.countryCode === activeCode
    ? draft
    : active
      ? { ...active, levels: active.levels.map(l => ({ ...l })) }
      : null;

  const beginEdit = () => active && setDraft({ ...active, levels: active.levels.map(l => ({ ...l })) });

  const saveMut = useMutation({
    mutationFn: async (h: HierarchyRow) => {
      const r = await fetch(`${API_BASE}/api/admin/country-hierarchies/${h.countryCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryCode: h.countryCode, countryName: h.countryName, levels: h.levels }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listCountryHierarchies"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/country-hierarchies"] });
      setDraft(null);
      setAddingNew(false);
      setNewCode("");
      setNewName("");
      toast({ title: "Hierarchy saved" });
    },
    onError: (e: any) => toast({ title: "Failed to save", description: e.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async (code: string) => {
      const r = await fetch(`${API_BASE}/api/admin/country-hierarchies/${code}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listCountryHierarchies"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/country-hierarchies"] });
      setSelectedCode("");
      setDraft(null);
      toast({ title: "Country hierarchy deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const updateLevelName = (idx: number, name: string) => {
    if (!current) return;
    const next = { ...current, levels: current.levels.map((l, i) => i === idx ? { ...l, name } : l) };
    setDraft(next);
  };
  const moveLevel = (idx: number, dir: -1 | 1) => {
    if (!current) return;
    const target = idx + dir;
    if (target < 0 || target >= current.levels.length) return;
    const lvls = current.levels.map(l => ({ ...l }));
    [lvls[idx], lvls[target]] = [lvls[target], lvls[idx]];
    const renum = lvls.map((l, i) => ({ ...l, level: i + 1 }));
    setDraft({ ...current, levels: renum });
  };
  const addLevel = () => {
    if (!current) return;
    if (current.levels.length >= 10) return;
    const next = { ...current, levels: [...current.levels, { level: current.levels.length + 1, name: "" }] };
    setDraft(next);
  };
  const removeLevel = (idx: number) => {
    if (!current) return;
    if (current.levels.length <= 1) return;
    const lvls = current.levels.filter((_, i) => i !== idx).map((l, i) => ({ ...l, level: i + 1 }));
    setDraft({ ...current, levels: lvls });
  };
  const updateCountryName = (name: string) => current && setDraft({ ...current, countryName: name });

  const submitDraft = () => {
    if (!current) return;
    const cleaned = current.levels.map(l => ({ ...l, name: l.name.trim() }));
    if (cleaned.some(l => !l.name)) { toast({ title: "All level names are required", variant: "destructive" }); return; }
    if (new Set(cleaned.map(l => l.name.toLowerCase())).size !== cleaned.length) {
      toast({ title: "Level names must be unique", variant: "destructive" }); return;
    }
    if (!current.countryName.trim()) { toast({ title: "Country name is required", variant: "destructive" }); return; }
    saveMut.mutate({ ...current, levels: cleaned });
  };

  const submitNew = () => {
    const code = newCode.trim().toUpperCase();
    const name = newName.trim();
    if (!/^[A-Z]{2,3}$/.test(code)) { toast({ title: "Country code must be 2–3 letters (e.g. UG)", variant: "destructive" }); return; }
    if (!name) { toast({ title: "Country name is required", variant: "destructive" }); return; }
    if (list.some(h => h.countryCode === code)) { toast({ title: `${code} already exists`, variant: "destructive" }); return; }
    saveMut.mutate({ countryCode: code, countryName: name, levels: [{ level: 1, name: "Region" }] });
  };

  const isDirty = !!draft && active ? JSON.stringify({ n: draft.countryName, l: draft.levels }) !== JSON.stringify({ n: active.countryName, l: active.levels }) : false;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="flex items-start gap-2">
          <Globe2 className="h-4 w-4 text-muted-foreground mt-1" />
          <div>
            <CardTitle>Country Administrative Hierarchy</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Define the level names, depth and order used by each country (e.g. Uganda: District → Sub-county → Parish → Village).</p>
          </div>
        </div>
        <Dialog open={addingNew} onOpenChange={setAddingNew}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2" data-testid="add-country-btn"><Plus className="h-4 w-4" /> Add Country</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Country</DialogTitle>
              <DialogDescription>Add a new country and start with one administrative level. You can add more levels after creation.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Country code (ISO 2-letter)</Label>
                <Input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="e.g. ET" maxLength={3} data-testid="new-country-code" />
              </div>
              <div>
                <Label>Country name</Label>
                <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Ethiopia" data-testid="new-country-name" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddingNew(false)}>Cancel</Button>
              <Button onClick={submitNew} disabled={saveMut.isPending} data-testid="submit-new-country">{saveMut.isPending ? "Adding..." : "Add"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <Skeleton className="h-40 w-full" /> : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No countries configured yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label>Country</Label>
                <Select value={activeCode} onValueChange={(v) => { setSelectedCode(v); setDraft(null); }}>
                  <SelectTrigger data-testid="hierarchy-country-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {list.map(h => (
                      <SelectItem key={h.countryCode} value={h.countryCode}>{h.countryName} ({h.countryCode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label>Country name</Label>
                <Input value={current?.countryName ?? ""} onChange={e => { if (!draft) beginEdit(); updateCountryName(e.target.value); }} data-testid="hierarchy-country-name" />
              </div>
            </div>

            {current && (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Levels (top to bottom)</Label>
                    <span className="text-xs text-muted-foreground">{current.levels.length} / 10</span>
                  </div>
                  <div className="border rounded-md divide-y">
                    {current.levels.map((lvl, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2" data-testid={`hierarchy-level-${idx}`}>
                        <Badge variant="outline" className="w-12 justify-center">L{idx + 1}</Badge>
                        <Input
                          value={lvl.name}
                          onChange={e => { if (!draft) beginEdit(); updateLevelName(idx, e.target.value); }}
                          placeholder="e.g. District"
                          className="flex-1"
                          data-testid={`hierarchy-level-name-${idx}`}
                        />
                        <Button size="icon" variant="ghost" disabled={idx === 0} onClick={() => { if (!draft) beginEdit(); moveLevel(idx, -1); }} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" disabled={idx === current.levels.length - 1} onClick={() => { if (!draft) beginEdit(); moveLevel(idx, 1); }} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" disabled={current.levels.length <= 1} onClick={() => { if (!draft) beginEdit(); removeLevel(idx); }} aria-label="Remove"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="gap-1" disabled={current.levels.length >= 10} onClick={() => { if (!draft) beginEdit(); addLevel(); }} data-testid="add-level-btn">
                    <Plus className="h-3 w-3" /> Add Level
                  </Button>
                </div>

                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <p className="font-semibold mb-1">Preview</p>
                  <p className="font-mono">
                    {current.levels.map(l => l.name || "?").join(" → ")}
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isDirty && <Badge variant="secondary">Unsaved changes</Badge>}
                    {current.updatedAt && !isDirty && <span className="text-xs text-muted-foreground">Last updated {new Date(current.updatedAt).toLocaleString()}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" disabled={!isDirty} onClick={() => setDraft(null)}>Cancel</Button>
                    <Button variant="destructive" onClick={() => { if (confirm(`Delete the ${current.countryName} hierarchy? Existing regions will keep their level numbers but lose their named labels.`)) deleteMut.mutate(current.countryCode); }} disabled={deleteMut.isPending} data-testid="delete-country-btn">
                      <Trash2 className="h-4 w-4 mr-1" /> Delete
                    </Button>
                    <Button onClick={submitDraft} disabled={!isDirty || saveMut.isPending} data-testid="save-hierarchy-btn" className="gap-2">
                      <Save className="h-4 w-4" />{saveMut.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
