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
import { useToast } from "@/hooks/use-toast";
import { ChevronRight, ChevronDown, MapPin, Plus, Pencil, GitMerge, Download, Upload, FileSpreadsheet, FileArchive, Power, AlertCircle } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Region = { id: string; name: string; parentId?: string | null; level: number; countryCode?: string; code?: string | null; isActive?: boolean };
type StatsMap = Record<string, { farmers: number; groups: number; plots: number }>;

function buildTree(regions: Region[]) {
  const byId = new Map<string, Region & { children: any[] }>();
  regions.forEach(r => byId.set(r.id, { ...r, children: [] }));
  const roots: any[] = [];
  for (const r of byId.values()) {
    if (r.parentId && byId.has(r.parentId)) byId.get(r.parentId)!.children.push(r);
    else roots.push(r);
  }
  const sortRec = (nodes: any[]) => { nodes.sort((a, b) => a.name.localeCompare(b.name)); nodes.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}

function rollupStats(node: any, stats: StatsMap): { farmers: number; groups: number; plots: number } {
  const own = stats[node.id] ?? { farmers: 0, groups: 0, plots: 0 };
  let f = own.farmers, g = own.groups, p = own.plots;
  for (const c of node.children) {
    const r = rollupStats(c, stats);
    f += r.farmers; g += r.groups; p += r.plots;
  }
  node._rollup = { farmers: f, groups: g, plots: p };
  return node._rollup;
}

export function RegionsManager() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: regions, isLoading } = useListRegions();
  const { data: hierarchies } = useListCountryHierarchies();

  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [showInactive, setShowInactive] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Region | null>(null);
  const [merging, setMerging] = useState<Region | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>("");
  const [importOpen, setImportOpen] = useState(false);
  const [shapefileOpen, setShapefileOpen] = useState(false);

  const { data: stats } = useQuery<StatsMap>({
    queryKey: ["/api/admin/regions/stats"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/regions/stats`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const filtered = useMemo(() => {
    if (!regions) return [] as Region[];
    return (regions as Region[]).filter(r =>
      (countryFilter === "all" || r.countryCode === countryFilter) &&
      (showInactive || r.isActive !== false)
    );
  }, [regions, countryFilter, showInactive]);

  const tree = useMemo(() => {
    const t = buildTree(filtered);
    if (stats) t.forEach(n => rollupStats(n, stats));
    return t;
  }, [filtered, stats]);

  const hierarchyForCountry = (code?: string) =>
    (hierarchies ?? []).find((h: any) => h.countryCode === code) as { levels: { level: number; name: string }[] } | undefined;

  const levelLabel = (countryCode: string | undefined, level: number) => {
    const h = hierarchyForCountry(countryCode);
    return h?.levels.find(l => l.level === level)?.name ?? `L${level}`;
  };

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const patchMut = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Region> }) => {
      const r = await fetch(`${API_BASE}/api/admin/regions/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listRegions"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/regions/stats"] });
      setEditing(null);
      toast({ title: "Region updated" });
    },
    onError: (e: any) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const mergeMut = useMutation({
    mutationFn: async ({ sourceId, targetId }: { sourceId: string; targetId: string }) => {
      const r = await fetch(`${API_BASE}/api/admin/regions/${sourceId}/merge`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (j) => {
      qc.invalidateQueries({ queryKey: ["listRegions"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/regions/stats"] });
      setMerging(null); setMergeTargetId("");
      toast({ title: "Regions merged", description: `${j.farmersMoved} farmers, ${j.groupsMoved} groups, ${j.childRegionsMoved} sub-regions reassigned.` });
    },
    onError: (e: any) => toast({ title: "Merge failed", description: e.message, variant: "destructive" }),
  });

  const handleExport = async () => {
    const r = await fetch(`${API_BASE}/api/admin/regions/export`);
    if (!r.ok) { toast({ title: "Export failed", variant: "destructive" }); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `regions-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const renderRows = (nodes: any[], depth = 0): ReactElement[] => {
    const out: ReactElement[] = [];
    for (const n of nodes) {
      const hasChildren = n.children.length > 0;
      const isExpanded = expanded.has(n.id);
      const own = stats?.[n.id] ?? { farmers: 0, groups: 0, plots: 0 };
      const roll = n._rollup ?? own;
      out.push(
        <TableRow key={n.id} className={n.isActive === false ? "opacity-60" : ""} data-testid={`region-row-${n.id}`}>
          <TableCell>
            <div className="flex items-center gap-1" style={{ paddingLeft: depth * 18 }}>
              {hasChildren ? (
                <Button size="icon" variant="ghost" className="h-5 w-5 p-0" onClick={() => toggle(n.id)} aria-label={isExpanded ? "Collapse" : "Expand"}>
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </Button>
              ) : <span className="w-5 inline-block" />}
              <span className="font-medium">{n.name}</span>
              {n.code && <code className="text-xs text-muted-foreground">({n.code})</code>}
              {n.isActive === false && <Badge variant="outline" className="text-xs">inactive</Badge>}
            </div>
          </TableCell>
          <TableCell><Badge variant="outline">{levelLabel(n.countryCode, n.level)}</Badge></TableCell>
          <TableCell>{n.countryCode}</TableCell>
          <TableCell className="text-right tabular-nums">
            {own.farmers}{hasChildren && roll.farmers !== own.farmers ? <span className="text-xs text-muted-foreground"> ({roll.farmers})</span> : ""}
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {own.groups}{hasChildren && roll.groups !== own.groups ? <span className="text-xs text-muted-foreground"> ({roll.groups})</span> : ""}
          </TableCell>
          <TableCell className="text-right tabular-nums">{own.plots}</TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-1">
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(n)} data-testid={`edit-region-${n.id}`} aria-label="Edit"><Pencil className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setMerging(n); setMergeTargetId(""); }} data-testid={`merge-region-${n.id}`} aria-label="Merge"><GitMerge className="h-3 w-3" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => patchMut.mutate({ id: n.id, patch: { isActive: !(n.isActive !== false) } })} data-testid={`toggle-region-${n.id}`} aria-label={n.isActive === false ? "Activate" : "Deactivate"}>
                <Power className={`h-3 w-3 ${n.isActive === false ? "text-muted-foreground" : "text-emerald-600"}`} />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
      if (isExpanded && hasChildren) out.push(...renderRows(n.children, depth + 1));
    }
    return out;
  };

  const allCountries = useMemo(() => {
    const set = new Set<string>();
    (regions as Region[] | undefined)?.forEach(r => r.countryCode && set.add(r.countryCode));
    (hierarchies as any[] | undefined)?.forEach(h => set.add(h.countryCode));
    return Array.from(set).sort();
  }, [regions, hierarchies]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 flex-wrap">
        <div className="flex items-start gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground mt-1" />
          <div>
            <CardTitle>Administrative Units</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Tree of regions with farmer / group / plot counts. Click a row to edit, merge, or deactivate. Numbers in parentheses include sub-regions.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-32" data-testid="region-country-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All countries</SelectItem>
              {allCountries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-xs">
            <Switch checked={showInactive} onCheckedChange={setShowInactive} id="show-inactive" data-testid="show-inactive-toggle" />
            <Label htmlFor="show-inactive" className="text-xs">Show inactive</Label>
          </div>
          <Button size="sm" variant="outline" className="gap-1" onClick={handleExport} data-testid="export-regions-btn"><Download className="h-3 w-3" /> Export CSV</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setImportOpen(true)} data-testid="import-csv-btn"><FileSpreadsheet className="h-3 w-3" /> Import CSV</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShapefileOpen(true)} data-testid="import-shapefile-btn"><FileArchive className="h-3 w-3" /> Shapefile</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Level</TableHead>
              <TableHead>Country</TableHead>
              <TableHead className="text-right">Farmers</TableHead>
              <TableHead className="text-right">Groups</TableHead>
              <TableHead className="text-right">Plots</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [1, 2, 3].map(i => <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-10 w-full" /></TableCell></TableRow>)
            ) : tree.length > 0 ? renderRows(tree) : (
              <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No regions configured</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* EDIT DIALOG */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Region</DialogTitle>
            <DialogDescription>Update name, code, or activation status.</DialogDescription>
          </DialogHeader>
          {editing && <EditRegionForm region={editing} onSave={(patch) => patchMut.mutate({ id: editing.id, patch })} saving={patchMut.isPending} />}
        </DialogContent>
      </Dialog>

      {/* MERGE DIALOG */}
      <Dialog open={!!merging} onOpenChange={(o) => !o && setMerging(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge Region</DialogTitle>
            <DialogDescription>
              All farmers, groups and sub-regions under <strong>{merging?.name}</strong> will be moved to the target region. The source will then be deleted. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Target region</Label>
            <Select value={mergeTargetId} onValueChange={setMergeTargetId}>
              <SelectTrigger data-testid="merge-target-select"><SelectValue placeholder="Pick the region to merge INTO" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {(regions as Region[] | undefined)?.filter(r => r.id !== merging?.id && r.countryCode === merging?.countryCode).map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name} — {levelLabel(r.countryCode, r.level)} ({r.countryCode})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {merging && stats && (
            <div className="rounded-md bg-muted/40 p-3 text-xs">
              <p>Will move: <strong>{stats[merging.id]?.farmers ?? 0}</strong> farmers, <strong>{stats[merging.id]?.groups ?? 0}</strong> groups, plus any sub-regions of <strong>{merging.name}</strong>.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMerging(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!mergeTargetId || mergeMut.isPending} onClick={() => merging && mergeTargetId && mergeMut.mutate({ sourceId: merging.id, targetId: mergeTargetId })} data-testid="confirm-merge-btn">
              {mergeMut.isPending ? "Merging..." : "Merge & Delete Source"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <HierarchicalImportDialog open={importOpen} onOpenChange={setImportOpen} hierarchies={hierarchies as any[] | undefined} />
      <ShapefileImportDialog open={shapefileOpen} onOpenChange={setShapefileOpen} hierarchies={hierarchies as any[] | undefined} />
    </Card>
  );
}

function EditRegionForm({ region, onSave, saving }: { region: Region; onSave: (patch: Partial<Region>) => void; saving: boolean }) {
  const [name, setName] = useState(region.name);
  const [code, setCode] = useState(region.code ?? "");
  const [isActive, setIsActive] = useState(region.isActive !== false);
  return (
    <>
      <div className="space-y-3">
        <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} data-testid="edit-region-name" /></div>
        <div><Label>Code (optional, e.g. ISO/admin code)</Label><Input value={code} onChange={e => setCode(e.target.value)} data-testid="edit-region-code" /></div>
        <div className="flex items-center gap-2">
          <Switch checked={isActive} onCheckedChange={setIsActive} id="edit-active" data-testid="edit-region-active" />
          <Label htmlFor="edit-active">Active</Label>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={() => onSave({ name: name.trim(), code: code.trim() || null, isActive })} disabled={saving || !name.trim()} data-testid="save-region-btn">{saving ? "Saving..." : "Save"}</Button>
      </DialogFooter>
    </>
  );
}

function HierarchicalImportDialog({ open, onOpenChange, hierarchies }: { open: boolean; onOpenChange: (o: boolean) => void; hierarchies: any[] | undefined }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [countryCode, setCountryCode] = useState("UG");
  const [csvText, setCsvText] = useState("");
  const [result, setResult] = useState<any>(null);

  const parseRows = (text: string) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return [];
    const headers = lines[0].split(",").map(h => h.trim());
    return lines.slice(1).map(line => {
      const cells: string[] = []; let cur = ""; let q = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
        else if (c === "," && !q) { cells.push(cur); cur = ""; } else cur += c;
      }
      cells.push(cur);
      const obj: any = {};
      headers.forEach((h, i) => { const v = cells[i]?.trim() ?? ""; if (v) obj[h] = h === "level" ? Number(v) : v; });
      return obj;
    });
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const rows = parseRows(csvText);
      if (rows.length === 0) throw new Error("No rows parsed from CSV");
      const r = await fetch(`${API_BASE}/api/admin/regions/import-hierarchical`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ countryCode, rows }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (j) => { setResult(j); qc.invalidateQueries({ queryKey: ["listRegions"] }); qc.invalidateQueries({ queryKey: ["/api/admin/regions/stats"] }); toast({ title: `Imported ${j.createdCount} regions${j.errorCount > 0 ? `, ${j.errorCount} failed` : ""}` }); },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  const downloadTemplate = () => {
    const csv = "name,level,parentName,parentPath,code\nMbale,1,,,UG-MBL\nBuwasa,2,Mbale,,\nBumagabula,3,,Mbale/Buwasa,\nLwanyaga,4,,Mbale/Buwasa/Bumagabula,\n";
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "regions-hierarchical-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setCsvText(""); setResult(null); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Hierarchical CSV</DialogTitle>
          <DialogDescription>
            Upload regions as a tree using parent <strong>names</strong> (no UUIDs needed). For each row, set <code>parentName</code> if the parent name is unique at its level, or <code>parentPath</code> like <code>"Mbale / Buwasa"</code> for unambiguous lookup.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Country</Label>
              <Select value={countryCode} onValueChange={setCountryCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(hierarchies ?? []).map((h: any) => <SelectItem key={h.countryCode} value={h.countryCode}>{h.countryName} ({h.countryCode})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button variant="outline" size="sm" className="gap-1" onClick={downloadTemplate}><FileSpreadsheet className="h-3 w-3" /> Template</Button>
            </div>
          </div>
          <div>
            <Label>CSV content</Label>
            <Textarea value={csvText} onChange={e => setCsvText(e.target.value)} rows={8} placeholder="name,level,parentName,parentPath,code&#10;Mbale,1,,,&#10;Buwasa,2,Mbale,,&#10;..." className="font-mono text-xs" data-testid="hierarchical-csv-text" />
          </div>
          <Input type="file" accept=".csv" onChange={async e => { const f = e.target.files?.[0]; if (f) setCsvText(await f.text()); }} data-testid="hierarchical-csv-file" />

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><Badge>{result.createdCount} created</Badge>{result.errorCount > 0 && <Badge variant="destructive">{result.errorCount} failed</Badge>}</div>
              {result.errors?.length > 0 && (
                <div className="border rounded max-h-40 overflow-auto text-xs">
                  {result.errors.slice(0, 50).map((e: any) => <div key={e.row} className="p-1 border-b text-destructive">Row {e.row}: {e.error}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => importMut.mutate()} disabled={!csvText.trim() || importMut.isPending} data-testid="submit-hierarchical-import">{importMut.isPending ? "Importing..." : "Import"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShapefileImportDialog({ open, onOpenChange, hierarchies }: { open: boolean; onOpenChange: (o: boolean) => void; hierarchies: any[] | undefined }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [countryCode, setCountryCode] = useState("UG");
  const [level, setLevel] = useState("1");
  const [nameProperty, setNameProperty] = useState("NAME");
  const [codeProperty, setCodeProperty] = useState("");
  const [parentNameProperty, setParentNameProperty] = useState("");
  const [fileBase64, setFileBase64] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [result, setResult] = useState<any>(null);

  const onFile = async (f: File) => {
    setFileName(f.name);
    setResult(null);
    if (f.size > 50 * 1024 * 1024) { toast({ title: "File exceeds 50 MB", variant: "destructive" }); return; }
    const buf = new Uint8Array(await f.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    setFileBase64(btoa(bin));
  };

  const importMut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/admin/regions/import-shapefile`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryCode, level: Number(level), nameProperty, codeProperty: codeProperty || undefined, parentNameProperty: parentNameProperty || undefined, fileBase64 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: (j) => { setResult(j); qc.invalidateQueries({ queryKey: ["listRegions"] }); qc.invalidateQueries({ queryKey: ["/api/admin/regions/stats"] }); toast({ title: `Shapefile imported`, description: `${j.createdCount} created, ${j.updatedCount} updated, ${j.errorCount} failed` }); },
    onError: (e: any) => toast({ title: "Shapefile import failed", description: e.message, variant: "destructive" }),
  });

  const country = (hierarchies ?? []).find((h: any) => h.countryCode === countryCode);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFileBase64(""); setFileName(""); setResult(null); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Shapefile (.zip)</DialogTitle>
          <DialogDescription>
            Upload a zipped shapefile (must contain .shp, .dbf, and .prj). Boundaries are stored as GeoJSON and matched to existing regions by name (case-insensitive). New regions are created if no match exists.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Country</Label>
              <Select value={countryCode} onValueChange={setCountryCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(hierarchies ?? []).map((h: any) => <SelectItem key={h.countryCode} value={h.countryCode}>{h.countryCode}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {country ? country.levels.map((l: any) => <SelectItem key={l.level} value={String(l.level)}>{l.level} — {l.name}</SelectItem>) : [1, 2, 3, 4, 5].map(l => <SelectItem key={l} value={String(l)}>L{l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Name property *</Label>
              <Input value={nameProperty} onChange={e => setNameProperty(e.target.value)} placeholder="NAME" data-testid="shapefile-name-prop" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Code property (optional)</Label><Input value={codeProperty} onChange={e => setCodeProperty(e.target.value)} placeholder="ADMIN_CODE" /></div>
            <div><Label>Parent name property (optional)</Label><Input value={parentNameProperty} onChange={e => setParentNameProperty(e.target.value)} placeholder="PARENT_NAME" /></div>
          </div>
          <div>
            <Label>Shapefile zip (.zip containing .shp, .dbf, .prj)</Label>
            <Input type="file" accept=".zip,application/zip" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} data-testid="shapefile-file" />
            {fileName && <p className="text-xs text-muted-foreground mt-1">{fileName} ({Math.round((fileBase64.length * 0.75) / 1024)} KB)</p>}
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-md bg-muted/40 p-2">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>The "name property" must match a column in the shapefile's DBF that holds the admin-unit name (e.g. <code>NAME</code>, <code>DNAME_2014</code>, <code>ADM2_EN</code>). National gazetteer downloads from sources like GADM, HDX, or government open-data portals usually work.</span>
          </div>

          {result && (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><Badge>{result.createdCount} created</Badge><Badge variant="secondary">{result.updatedCount} updated</Badge>{result.errorCount > 0 && <Badge variant="destructive">{result.errorCount} failed</Badge>}</div>
              {result.errors?.length > 0 && (
                <div className="border rounded max-h-40 overflow-auto text-xs">
                  {result.errors.slice(0, 50).map((e: any, i: number) => <div key={i} className="p-1 border-b text-destructive">Feature {e.feature}: {e.error}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={() => importMut.mutate()} disabled={!fileBase64 || !nameProperty || importMut.isPending} data-testid="submit-shapefile-import">
            <Upload className="h-4 w-4 mr-1" />{importMut.isPending ? "Uploading..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
