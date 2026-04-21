import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListRegions } from "@workspace/api-client-react";
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Map as MapIcon } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "");

type Region = { id: string; name: string; level: number; countryCode?: string; isActive?: boolean };

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => { if (bounds) try { map.fitBounds(bounds, { padding: [20, 20] }); } catch {} }, [bounds, map]);
  return null;
}

export function RegionsMap() {
  const { data: regions } = useListRegions();
  const [countryCode, setCountryCode] = useState<string>("UG");
  const [boundaryLevel, setBoundaryLevel] = useState<string>("all");
  const [filterRegionId, setFilterRegionId] = useState<string>("all");
  const [showFarmers, setShowFarmers] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);

  const { data: geojson } = useQuery<{ type: "FeatureCollection"; features: any[] }>({
    queryKey: ["/api/admin/regions/geojson", countryCode, boundaryLevel],
    queryFn: async () => {
      const params = new URLSearchParams({ countryCode });
      if (boundaryLevel !== "all") params.set("level", boundaryLevel);
      const r = await fetch(`${API_BASE}/api/admin/regions/geojson?${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const { data: farmerData } = useQuery<{ farmers: Array<{ id: string; name: string; ref: string; lat: number; lng: number; village?: string }> }>({
    queryKey: ["/api/admin/farmer-locations", filterRegionId],
    queryFn: async () => {
      const params = filterRegionId !== "all" ? `?regionId=${filterRegionId}` : "";
      const r = await fetch(`${API_BASE}/api/admin/farmer-locations${params}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    enabled: showFarmers,
  });

  const countryRegions = useMemo(
    () => ((regions ?? []) as Region[]).filter(r => r.countryCode === countryCode),
    [regions, countryCode]
  );

  const allCountries = useMemo(() => {
    const set = new Set<string>();
    ((regions ?? []) as Region[]).forEach(r => r.countryCode && set.add(r.countryCode));
    return Array.from(set).sort();
  }, [regions]);

  const levels = useMemo(() => Array.from(new Set(countryRegions.map(r => r.level))).sort(), [countryRegions]);

  // Compute bounds from features + farmers
  const bounds = useMemo<L.LatLngBoundsExpression | null>(() => {
    const points: [number, number][] = [];
    const walkCoords = (coords: any) => {
      if (typeof coords?.[0] === "number" && typeof coords?.[1] === "number") {
        points.push([coords[1], coords[0]]);
      } else if (Array.isArray(coords)) {
        coords.forEach(walkCoords);
      }
    };
    geojson?.features.forEach(f => walkCoords(f.geometry?.coordinates));
    if (showFarmers) farmerData?.farmers.forEach(f => points.push([f.lat, f.lng]));
    if (points.length === 0) return null;
    const lats = points.map(p => p[0]); const lngs = points.map(p => p[1]);
    return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]] as L.LatLngBoundsExpression;
  }, [geojson, farmerData, showFarmers]);

  const styleFn = () => ({ color: "#0d9488", weight: 1, fillColor: "#14b8a6", fillOpacity: 0.15 });

  // Country default centers
  const fallbackCenter: Record<string, [number, number]> = {
    UG: [1.3733, 32.2903], KE: [-0.0236, 37.9062], TZ: [-6.369, 34.8888], RW: [-1.9403, 29.8739],
  };
  const initialCenter: [number, number] = fallbackCenter[countryCode] ?? [0, 30];

  const featureCount = geojson?.features.length ?? 0;
  const farmerCount = farmerData?.farmers.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 flex-wrap">
        <div className="flex items-start gap-2">
          <MapIcon className="h-4 w-4 text-muted-foreground mt-1" />
          <div>
            <CardTitle>Map View</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Administrative boundaries (from imported shapefiles) overlaid with farmer locations (centroids of mapped plots).</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{featureCount} boundaries</Badge>
          {showFarmers && <Badge variant="outline">{farmerCount} farmers</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label>Country</Label>
            <Select value={countryCode} onValueChange={setCountryCode}>
              <SelectTrigger data-testid="map-country-select"><SelectValue /></SelectTrigger>
              <SelectContent>{allCountries.length > 0 ? allCountries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>) : ["UG", "KE", "TZ", "RW"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Boundary level</Label>
            <Select value={boundaryLevel} onValueChange={setBoundaryLevel}>
              <SelectTrigger data-testid="map-level-select"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All levels</SelectItem>
                {levels.map(l => <SelectItem key={l} value={String(l)}>Level {l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Filter farmers by region</Label>
            <Select value={filterRegionId} onValueChange={setFilterRegionId}>
              <SelectTrigger data-testid="map-region-filter"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All regions</SelectItem>
                {countryRegions.map(r => <SelectItem key={r.id} value={r.id}>{r.name} (L{r.level})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 mt-6">
            <Switch checked={showBoundaries} onCheckedChange={setShowBoundaries} id="show-boundaries" />
            <Label htmlFor="show-boundaries">Boundaries</Label>
          </div>
          <div className="flex items-center gap-2 mt-6">
            <Switch checked={showFarmers} onCheckedChange={setShowFarmers} id="show-farmers" />
            <Label htmlFor="show-farmers">Farmer pins</Label>
          </div>
        </div>

        <div className="border rounded-md overflow-hidden" style={{ height: 520 }}>
          <MapContainer center={initialCenter} zoom={6} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {showBoundaries && geojson && geojson.features.length > 0 && (
              <GeoJSON
                key={`${countryCode}-${boundaryLevel}-${geojson.features.length}`}
                data={geojson as any}
                style={styleFn as any}
                onEachFeature={(feature, layer) => {
                  const p = feature.properties ?? {};
                  layer.bindTooltip(`<strong>${p.name}</strong><br/>Level ${p.level} (${p.countryCode})`, { sticky: true });
                }}
              />
            )}
            {showFarmers && farmerData?.farmers.map(f => (
              <CircleMarker key={f.id} center={[f.lat, f.lng]} radius={4} pathOptions={{ color: "#dc2626", fillColor: "#ef4444", fillOpacity: 0.8, weight: 1 }}>
                <Tooltip>
                  <div className="text-xs">
                    <div className="font-semibold">{f.name}</div>
                    <div className="font-mono">{f.ref}</div>
                    {f.village && <div>{f.village}</div>}
                  </div>
                </Tooltip>
              </CircleMarker>
            ))}
            <FitBounds bounds={bounds} />
          </MapContainer>
        </div>

        {featureCount === 0 && (
          <p className="text-xs text-muted-foreground">No boundary geometry imported yet for {countryCode}. Upload a shapefile from the <strong>Regions tab → Shapefile</strong> to see administrative boundaries here.</p>
        )}
        {showFarmers && farmerCount === 0 && (
          <p className="text-xs text-muted-foreground">No farmer pins to show. Farmer locations are computed from the centroid of their first mapped plot polygon — make sure plots have GPS data.</p>
        )}
      </CardContent>
    </Card>
  );
}
