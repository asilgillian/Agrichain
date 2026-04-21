import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListRegions, useListGroups } from "@workspace/api-client-react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Map as MapIcon, Download, Pencil, Layers, BarChart3, Save, X } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type PlotProps = {
  id: string; farmerId: string; farmerName: string; farmerRef: string;
  groupId: string | null; groupName: string | null;
  regionId: string | null; regionName: string | null;
  name: string | null; cropType: string;
  areaHectares: number; status: string; harvestDate: string | null;
};
type PlotFeature = { type: "Feature"; geometry: any; properties: PlotProps };
type PlotGeoJSON = { type: "FeatureCollection"; features: PlotFeature[]; totalCount: number; mappedCount: number };
type StatRow = { key: string; keyId: string | null; plotCount: number; totalAreaHectares: number; farmerCount: number };

const CROP_COLORS: Record<string, string> = {
  Coffee: "#7c3a12", Maize: "#facc15", Beans: "#a16207", Cassava: "#65a30d",
  Banana: "#84cc16", Tea: "#15803d", Cotton: "#f3f4f6", Sorghum: "#b45309",
};
const colorFor = (crop: string) => CROP_COLORS[crop] ?? "#0d9488";

function FitBounds({ data }: { data: PlotGeoJSON | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (!data || data.features.length === 0) return;
    const points: [number, number][] = [];
    const walk = (c: any) => {
      if (typeof c?.[0] === "number" && typeof c?.[1] === "number") points.push([c[1], c[0]]);
      else if (Array.isArray(c)) c.forEach(walk);
    };
    data.features.forEach(f => walk(f.geometry?.coordinates));
    if (points.length === 0) return;
    const lats = points.map(p => p[0]); const lngs = points.map(p => p[1]);
    try { map.fitBounds([[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]], { padding: [30, 30], maxZoom: 16 }); } catch {}
  }, [data, map]);
  return null;
}

// Geoman-based polygon editor: when `editing` is set, mounts the polygon as an editable layer.
function PolygonEditor({ editingFeature, onSave, onCancel }: {
  editingFeature: PlotFeature | null;
  onSave: (geometry: any) => void;
  onCancel: () => void;
}) {
  const map = useMap();
  const layerRef = useRef<L.Layer | null>(null);

  useEffect(() => {
    if (!editingFeature || !editingFeature.geometry) return;
    const layer = L.geoJSON(editingFeature.geometry, {
      style: { color: "#dc2626", weight: 3, fillColor: "#fca5a5", fillOpacity: 0.3, dashArray: "5,5" } as any,
    }).addTo(map);
    layerRef.current = layer;
    // Enable editing on each sub-layer
    layer.eachLayer((sub: any) => { if (sub.pm) sub.pm.enable({ allowSelfIntersection: false }); });
    try {
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 18 });
    } catch {}
    return () => {
      layer.eachLayer((sub: any) => { if (sub.pm) sub.pm.disable(); });
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [editingFeature, map]);

  if (!editingFeature) return null;

  const handleSave = () => {
    const layer = layerRef.current as any;
    if (!layer) return;
    const geo = layer.toGeoJSON();
    // toGeoJSON on a FeatureCollection vs Feature — extract first geometry
    let geom: any = null;
    if (geo.type === "FeatureCollection" && geo.features?.[0]) geom = geo.features[0].geometry;
    else if (geo.type === "Feature") geom = geo.geometry;
    else geom = geo;
    if (!geom) return;
    onSave(geom);
  };

  return (
    <div className="absolute top-2 right-2 z-[1000] bg-background border rounded-md shadow-lg p-2 flex items-center gap-2" data-testid="polygon-editor-toolbar">
      <span className="text-xs font-semibold">Editing: {editingFeature.properties.name ?? editingFeature.properties.farmerName}</span>
      <Button size="sm" variant="default" className="gap-1 h-7" onClick={handleSave} data-testid="save-polygon-btn"><Save className="h-3 w-3" /> Save</Button>
      <Button size="sm" variant="outline" className="gap-1 h-7" onClick={onCancel} data-testid="cancel-polygon-btn"><X className="h-3 w-3" /> Cancel</Button>
    </div>
  );
}

export default function PlotsMapPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: regions } = useListRegions();
  const { data: groups } = useListGroups();

  const [regionId, setRegionId] = useState<string>("all");
  const [groupId, setGroupId] = useState<string>("all");
  const [cropType, setCropType] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingProps, setEditingProps] = useState<PlotProps | null>(null);
  const [editingGeometry, setEditingGeometry] = useState<PlotFeature | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (regionId !== "all") p.set("regionId", regionId);
    if (groupId !== "all") p.set("groupId", groupId);
    if (cropType !== "all") p.set("cropType", cropType);
    if (statusFilter !== "all") p.set("status", statusFilter);
    return p.toString();
  }, [regionId, groupId, cropType, statusFilter]);

  const { data: geojson, isLoading } = useQuery<PlotGeoJSON>({
    queryKey: ["/api/plots/geojson", queryString],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/plots/geojson?${queryString}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const [statsGroupBy, setStatsGroupBy] = useState<"region" | "group" | "crop" | "status">("region");
  const { data: stats } = useQuery<{ groupBy: string; rows: StatRow[] }>({
    queryKey: ["/api/plots/stats", statsGroupBy, queryString],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/plots/stats?groupBy=${statsGroupBy}&${queryString}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const allCrops = useMemo(() => {
    const set = new Set<string>();
    geojson?.features.forEach(f => set.add(f.properties.cropType));
    Object.keys(CROP_COLORS).forEach(c => set.add(c));
    return Array.from(set).sort();
  }, [geojson]);

  const patchPlot = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: any }) => {
      const r = await fetch(`${API_BASE}/api/plots/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      return j;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/plots/geojson"] });
      qc.invalidateQueries({ queryKey: ["/api/plots/stats"] });
      toast({ title: "Plot updated" });
      setEditingProps(null);
      setEditingGeometry(null);
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const handleExport = (format: "geojson" | "csv" | "kml") => {
    const url = `${API_BASE}/api/plots/export?format=${format}&${queryString}`;
    const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.click();
  };

  const center: [number, number] = [1.3733, 32.2903]; // Uganda
  const totalArea = stats?.rows.reduce((s, r) => s + r.totalAreaHectares, 0) ?? 0;

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><MapIcon className="h-6 w-6 text-emerald-600" /> Farm Plots — GIS</h1>
          <p className="text-sm text-muted-foreground">Interactive map of all mapped plots, with edit, area analysis, and export.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExport("geojson")} data-testid="export-geojson-btn"><Download className="h-3 w-3" /> GeoJSON</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExport("csv")} data-testid="export-csv-btn"><Download className="h-3 w-3" /> CSV</Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => handleExport("kml")} data-testid="export-kml-btn"><Download className="h-3 w-3" /> KML</Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Region / District</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger data-testid="filter-region"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All regions</SelectItem>
                  {(regions as any[] ?? []).map(r => <SelectItem key={r.id} value={r.id}>{r.name} (L{r.level} · {r.countryCode})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Group</Label>
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger data-testid="filter-group"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All groups</SelectItem>
                  {(groups as any[] ?? []).map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Crop type</Label>
              <Select value={cropType} onValueChange={setCropType}>
                <SelectTrigger data-testid="filter-crop"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All crops</SelectItem>
                  {allCrops.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="filter-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="harvested">Harvested</SelectItem>
                  <SelectItem value="fallow">Fallow</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Badge variant="outline" className="h-9 px-3"><Layers className="h-3 w-3 mr-1" />{geojson?.mappedCount ?? 0} mapped / {geojson?.totalCount ?? 0} plots</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2"><MapIcon className="h-4 w-4" /> Map</CardTitle>
          </CardHeader>
          <CardContent className="p-0 relative">
            <div style={{ height: 600 }}>
              <MapContainer center={center} zoom={7} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {geojson && !editingGeometry && (
                  <GeoJSON
                    key={`${queryString}-${geojson.features.length}`}
                    data={geojson as any}
                    style={(f: any) => ({
                      color: colorFor(f.properties?.cropType),
                      weight: 2,
                      fillColor: colorFor(f.properties?.cropType),
                      fillOpacity: f.properties?.status === "active" ? 0.45 : 0.2,
                    })}
                    onEachFeature={(feature, layer) => {
                      const p = feature.properties as PlotProps;
                      const html = `<div class="text-xs">
                        <div class="font-semibold">${p.name ?? p.cropType}</div>
                        <div>${p.farmerName} (${p.farmerRef})</div>
                        <div>${p.cropType} · ${p.areaHectares.toFixed(2)} ha · ${p.status}</div>
                        <div class="text-muted-foreground">${p.regionName ?? ""}${p.groupName ? ` · ${p.groupName}` : ""}</div>
                      </div>`;
                      layer.bindTooltip(html, { sticky: true });
                      layer.on("click", () => setEditingProps(p));
                    }}
                  />
                )}
                <FitBounds data={editingGeometry ? undefined : geojson} />
                <PolygonEditor
                  editingFeature={editingGeometry}
                  onSave={(geom) => editingGeometry && patchPlot.mutate({ id: editingGeometry.properties.id, patch: { polygon: geom } })}
                  onCancel={() => setEditingGeometry(null)}
                />
              </MapContainer>
            </div>
            {isLoading && <div className="absolute inset-0 bg-background/60 flex items-center justify-center"><Skeleton className="h-12 w-48" /></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Area analysis</CardTitle>
            <Select value={statsGroupBy} onValueChange={(v) => setStatsGroupBy(v as any)}>
              <SelectTrigger className="w-32 h-8" data-testid="stats-groupby"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="region">By region</SelectItem>
                <SelectItem value="group">By group</SelectItem>
                <SelectItem value="crop">By crop</SelectItem>
                <SelectItem value="status">By status</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-4 py-2 border-b bg-muted/30 text-xs font-medium">
              Total mapped: <span className="text-base font-bold">{totalArea.toFixed(2)} ha</span>
              <span className="text-muted-foreground"> across {stats?.rows.length ?? 0} {statsGroupBy}s</span>
            </div>
            <div className="max-h-[510px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{statsGroupBy === "region" ? "Region" : statsGroupBy === "group" ? "Group" : statsGroupBy === "crop" ? "Crop" : "Status"}</TableHead>
                    <TableHead className="text-right">Plots</TableHead>
                    <TableHead className="text-right">Farmers</TableHead>
                    <TableHead className="text-right">Hectares</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats?.rows.map((r, i) => (
                    <TableRow key={`${r.key}-${i}`} data-testid={`stat-row-${r.key}`}>
                      <TableCell className="font-medium">
                        {statsGroupBy === "crop" && <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: colorFor(r.key) }} />}
                        {r.key}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.plotCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.farmerCount}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{r.totalAreaHectares.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {!stats?.rows.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* EDIT ATTRIBUTES DIALOG */}
      <Dialog open={!!editingProps && !editingGeometry} onOpenChange={(o) => !o && setEditingProps(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingProps?.name ?? "Plot"} — {editingProps?.farmerName}</DialogTitle>
            <DialogDescription>
              {editingProps?.regionName} {editingProps?.groupName ? `· ${editingProps.groupName}` : ""} · ref {editingProps?.farmerRef}
            </DialogDescription>
          </DialogHeader>
          {editingProps && <PlotEditForm props={editingProps} onSave={(patch) => patchPlot.mutate({ id: editingProps.id, patch })} saving={patchPlot.isPending} onEditPolygon={() => {
            const feat = geojson?.features.find(f => f.properties.id === editingProps.id);
            if (feat) { setEditingGeometry(feat); }
            else toast({ title: "No polygon to edit", description: "This plot has no boundary saved.", variant: "destructive" });
          }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlotEditForm({ props, onSave, saving, onEditPolygon }: { props: PlotProps; onSave: (patch: any) => void; saving: boolean; onEditPolygon: () => void }) {
  const [name, setName] = useState(props.name ?? "");
  const [cropType, setCropType] = useState(props.cropType);
  const [areaHectares, setAreaHectares] = useState(String(props.areaHectares));
  const [status, setStatus] = useState(props.status);
  const [harvestDate, setHarvestDate] = useState(props.harvestDate ?? "");
  return (
    <>
      <div className="space-y-3">
        <div><Label>Plot name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. North field" data-testid="edit-plot-name" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Crop type</Label>
            <Select value={cropType} onValueChange={setCropType}>
              <SelectTrigger data-testid="edit-plot-crop"><SelectValue /></SelectTrigger>
              <SelectContent>{["Coffee", "Maize", "Beans", "Cassava", "Banana", "Tea", "Cotton", "Sorghum"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Area (ha)</Label><Input type="number" step="0.0001" min="0" value={areaHectares} onChange={e => setAreaHectares(e.target.value)} data-testid="edit-plot-area" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger data-testid="edit-plot-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="harvested">Harvested</SelectItem>
                <SelectItem value="fallow">Fallow</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Harvest date</Label><Input type="date" value={harvestDate} onChange={e => setHarvestDate(e.target.value)} data-testid="edit-plot-harvest" /></div>
        </div>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onEditPolygon} className="gap-1" data-testid="edit-polygon-btn"><Pencil className="h-3 w-3" /> Edit polygon on map</Button>
        <Button onClick={() => onSave({
          name: name.trim() || null,
          cropType, status,
          areaHectares: Number(areaHectares),
          harvestDate: harvestDate || null,
        })} disabled={saving || !cropType || !areaHectares} data-testid="save-plot-attrs-btn">{saving ? "Saving..." : "Save attributes"}</Button>
      </DialogFooter>
    </>
  );
}
