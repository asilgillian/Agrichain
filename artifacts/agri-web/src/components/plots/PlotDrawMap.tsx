import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";
import { Button } from "@/components/ui/button";
import { Locate, Trash2, MapPinned, Pentagon } from "lucide-react";

// Default centre = Kampala, Uganda. Used when geolocation is unavailable.
const DEFAULT_CENTRE: [number, number] = [0.3476, 32.5825];
const DEFAULT_ZOOM = 7;

export type DrawnGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: number[][][] };

type DrawMode = "point" | "polygon";

const geomEqual = (a: DrawnGeometry | null, b: DrawnGeometry | null): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  return JSON.stringify(a.coordinates) === JSON.stringify(b.coordinates);
};

const layerToGeometry = (layer: L.Layer): DrawnGeometry | null => {
  if (layer instanceof L.Marker) {
    const ll = layer.getLatLng();
    return { type: "Point", coordinates: [ll.lng, ll.lat] };
  }
  if (layer instanceof L.Polygon) {
    const gj: any = layer.toGeoJSON();
    if (gj?.geometry?.type === "Polygon") return { type: "Polygon", coordinates: gj.geometry.coordinates };
  }
  return null;
};

/**
 * Inner component that owns the Geoman draw bindings. Mounted inside <MapContainer>
 * so it can call useMap() to get the leaflet instance.
 *
 * State sync model (no remount-on-every-change):
 *   - We track the geometry we *last emitted* in `lastEmittedRef`.
 *   - Whenever the prop `value` changes, if it differs from what we last emitted,
 *     it's an external change — replace the on-screen layer accordingly.
 *   - On user draw/edit/remove we update lastEmittedRef BEFORE calling onChange,
 *     so the resulting prop update is recognised as our own and is a no-op.
 *   - On unmount we clean up the leaflet layer, geoman controls, and listeners.
 */
function DrawController({
  mode,
  value,
  onChange,
}: {
  mode: DrawMode;
  value: DrawnGeometry | null;
  onChange: (geom: DrawnGeometry | null) => void;
}) {
  const map = useMap();
  const drawnLayer = useRef<L.Layer | null>(null);
  const lastEmittedRef = useRef<DrawnGeometry | null>(null);

  // Bind a layer's edit/drag/remove handlers so subsequent changes propagate.
  const bindLayerEvents = (layer: L.Layer) => {
    layer.on("pm:edit pm:dragend", () => {
      const g = layerToGeometry(layer);
      lastEmittedRef.current = g;
      onChange(g);
    });
    layer.on("pm:remove", () => {
      drawnLayer.current = null;
      lastEmittedRef.current = null;
      onChange(null);
    });
  };

  // Replace the on-screen drawn layer with one matching `geom`. Always removes
  // any previous layer first so we never accumulate shapes.
  const renderGeometry = (geom: DrawnGeometry | null) => {
    if (drawnLayer.current) {
      try { map.removeLayer(drawnLayer.current); } catch { /* noop */ }
      drawnLayer.current = null;
    }
    if (!geom) return;
    if (geom.type === "Point") {
      const m = L.marker([geom.coordinates[1], geom.coordinates[0]]);
      m.addTo(map);
      drawnLayer.current = m;
      bindLayerEvents(m);
      try { map.setView([geom.coordinates[1], geom.coordinates[0]], Math.max(map.getZoom(), 15)); } catch { /* noop */ }
    } else {
      // GeoJSON Polygon = [ [ [lng, lat], ... ] ]; Leaflet wants [[lat, lng], ...]
      const ring = geom.coordinates[0].map(([lng, lat]) => [lat, lng]) as [number, number][];
      const p = L.polygon(ring, { color: "#0d9488", weight: 2, fillOpacity: 0.25 });
      p.addTo(map);
      drawnLayer.current = p;
      bindLayerEvents(p);
      try { map.fitBounds(p.getBounds(), { padding: [30, 30], maxZoom: 17 }); } catch { /* noop */ }
    }
  };

  // Sync the layer to the prop whenever the prop differs from what we last emitted.
  // Internal user-driven updates pass through this guard as a no-op because we update
  // lastEmittedRef before calling onChange.
  useEffect(() => {
    if (!geomEqual(value, lastEmittedRef.current)) {
      lastEmittedRef.current = value;
      renderGeometry(value);
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire up the Geoman toolbar + create handler. Re-runs when mode toggles so the
  // toolbar shows only the relevant tool. We tear down on unmount to avoid leaks.
  useEffect(() => {
    const pm = (map as any).pm;
    if (!pm) return;
    pm.removeControls();
    pm.addControls({
      position: "topleft",
      drawMarker: mode === "point",
      drawPolygon: mode === "polygon",
      drawCircle: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: false,
      drawText: false,
      editMode: true,
      dragMode: true,
      cutPolygon: false,
      removalMode: true,
      rotateMode: false,
    });

    const onCreate = (e: any) => {
      // Replace any prior layer (only one shape at a time) and surface the geometry.
      if (drawnLayer.current && drawnLayer.current !== e.layer) {
        try { map.removeLayer(drawnLayer.current); } catch { /* noop */ }
      }
      drawnLayer.current = e.layer;
      const geom = layerToGeometry(e.layer);
      lastEmittedRef.current = geom;
      onChange(geom);
      bindLayerEvents(e.layer);
    };
    map.on("pm:create", onCreate);

    return () => {
      map.off("pm:create", onCreate);
      try { pm.removeControls(); } catch { /* noop */ }
    };
  }, [map, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Final cleanup: remove the on-screen layer when the component unmounts.
  useEffect(() => {
    return () => {
      if (drawnLayer.current) {
        try { map.removeLayer(drawnLayer.current); } catch { /* noop */ }
        drawnLayer.current = null;
      }
    };
  }, [map]);

  return null;
}

export function PlotDrawMap({
  mode,
  value,
  onChange,
  onModeChange,
  onUseMyLocation,
  height = 360,
}: {
  mode: DrawMode;
  value: DrawnGeometry | null;
  onChange: (geom: DrawnGeometry | null) => void;
  onModeChange: (mode: DrawMode) => void;
  onUseMyLocation?: () => void;
  height?: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border bg-background p-0.5">
          <Button
            type="button"
            size="sm"
            variant={mode === "point" ? "default" : "ghost"}
            className="gap-2"
            onClick={() => { onModeChange("point"); onChange(null); }}
            data-testid="plot-mode-point"
          >
            <MapPinned className="h-4 w-4" /> Single point
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "polygon" ? "default" : "ghost"}
            className="gap-2"
            onClick={() => { onModeChange("polygon"); onChange(null); }}
            data-testid="plot-mode-polygon"
          >
            <Pentagon className="h-4 w-4" /> Polygon outline
          </Button>
        </div>
        {onUseMyLocation && (
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={onUseMyLocation} data-testid="plot-use-my-location">
            <Locate className="h-4 w-4" /> Use my location
          </Button>
        )}
        {value && (
          <Button type="button" variant="ghost" size="sm" className="gap-2 text-destructive" onClick={() => onChange(null)} data-testid="plot-clear">
            <Trash2 className="h-4 w-4" /> Clear
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {mode === "point" ? "Click on the map to drop a pin" : "Click corners to outline the plot, double-click to finish"}
        </span>
      </div>
      <div style={{ height }} className="rounded-md overflow-hidden border" data-testid="plot-draw-map">
        <MapContainer center={DEFAULT_CENTRE} zoom={DEFAULT_ZOOM} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <DrawController mode={mode} value={value} onChange={onChange} />
        </MapContainer>
      </div>
      {value && (
        <p className="text-xs text-muted-foreground" data-testid="plot-geom-summary">
          {value.type === "Point"
            ? `Pin at ${value.coordinates[1].toFixed(5)}, ${value.coordinates[0].toFixed(5)}`
            : `Polygon with ${value.coordinates[0].length - 1} vertices`}
        </p>
      )}
    </div>
  );
}
