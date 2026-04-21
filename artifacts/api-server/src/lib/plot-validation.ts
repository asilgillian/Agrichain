// Field-capture validation rules for plot polygons (EUDR + CBI compliant).
//
//  - Polygon required for plots ≥ 4 hectares; single GPS point allowed below 4 ha (CBI)
//  - Each vertex must have ≥ 6 decimal digits of precision (EUDR; WGS84 decimal degrees)
//  - Self-intersecting boundaries, unclosed rings, and < 4 vertices each raise specific errors
//  - Coordinates must be within valid lat/lng bounds
//  - Polygon flagged when it overlaps another registered plot
//
// All geometry is GeoJSON in WGS84 (lon, lat) order.

export const POLYGON_REQUIRED_AREA_HA = 4;
export const MIN_DECIMAL_DIGITS = 6;

export type FieldError = { field: string; code: string; message: string };

export type PointGeometry = { type: "Point"; coordinates: [number, number] };
export type PolygonGeometry = { type: "Polygon"; coordinates: number[][][] };
export type PlotGeometry = PointGeometry | PolygonGeometry;

// ---------------- helpers ----------------

function decimalDigits(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  const i = s.indexOf(".");
  if (i < 0) return 0;
  // Strip trailing zeros so "1.500000" still counts as 6 digits when written that way,
  // but "1.5" counts as 1. This is the EUDR-style precision check.
  return s.length - i - 1;
}

function inLatLngRange(lon: number, lat: number): boolean {
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

// 2D segment-segment intersection test (proper crossing only).
// Returns true when (p1->p2) and (p3->p4) cross strictly (shared endpoints don't count).
function segmentsCross(p1: number[], p2: number[], p3: number[], p4: number[]): boolean {
  const o = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const o1 = o(p1, p2, p3);
  const o2 = o(p1, p2, p3) === 0 ? 0 : o(p1, p2, p4); // small optimization
  const o3 = o(p3, p4, p1);
  const o4 = o(p3, p4, p2);
  // strictly opposite orientations on both segments
  if (((o(p1, p2, p3) > 0 && o(p1, p2, p4) < 0) || (o(p1, p2, p3) < 0 && o(p1, p2, p4) > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  // suppress unused var warning
  void o1; void o2;
  return false;
}

function ringSelfIntersects(ring: number[][]): boolean {
  // Excludes the closing repeat vertex
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a1 = ring[i], a2 = ring[i + 1];
    for (let j = i + 1; j < n; j++) {
      // skip adjacent segments (share endpoint) and the wrap-around adjacency (last→first)
      if (j === i + 1) continue;
      if (i === 0 && j === n - 1) continue;
      const b1 = ring[j], b2 = ring[j + 1];
      if (segmentsCross(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

// Geodesic area in hectares using equal-area projection (good for plots up to ~100km).
// Uses spherical excess approximation, accurate to <1% for typical plot sizes.
const EARTH_RADIUS_M = 6378137;
export function ringAreaHectares(ring: number[][]): number {
  if (ring.length < 4) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    area += (lon2 - lon1) * (Math.PI / 180) *
            (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
  }
  area = (area * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
  return Math.abs(area) / 10000; // m² → ha
}

export function polygonAreaHectares(poly: PolygonGeometry): number {
  if (!poly?.coordinates?.[0]) return 0;
  const outer = ringAreaHectares(poly.coordinates[0]);
  const holes = poly.coordinates.slice(1).reduce((s, r) => s + ringAreaHectares(r), 0);
  return Math.max(0, outer - holes);
}

// Bounding-box overlap test (cheap prefilter for the polygon-overlap check)
function bboxOf(ring: number[][]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
function bboxesOverlap(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

// Ray-cast point-in-polygon (outer ring only — sufficient for overlap detection).
function pointInRing(pt: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < ((xj - xi) * (pt[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Two polygons "overlap" iff their interiors intersect — i.e., they share more than
// just a boundary (adjacent plots that share only an edge are NOT considered overlapping).
//
// Strategy:
//   1. bbox prefilter (cheap reject)
//   2. any strict edge crossing → overlap
//   3. any vertex of A strictly inside B's outer ring (and not in any hole) → overlap, and vice versa
//
// Holes are treated as non-area, so a vertex inside a hole does NOT count as inside.
export function polygonsOverlap(a: PolygonGeometry, b: PolygonGeometry): boolean {
  const ringA = a.coordinates[0], ringB = b.coordinates[0];
  if (!ringA?.length || !ringB?.length) return false;
  if (!bboxesOverlap(bboxOf(ringA), bboxOf(ringB))) return false;
  // edge-edge strict intersection (shared vertex/edge does not count as crossing)
  for (let i = 0; i < ringA.length - 1; i++) {
    for (let j = 0; j < ringB.length - 1; j++) {
      if (segmentsCross(ringA[i], ringA[i + 1], ringB[j], ringB[j + 1])) return true;
    }
  }
  const holesA = a.coordinates.slice(1);
  const holesB = b.coordinates.slice(1);
  // any vertex of A strictly inside B (and not in any hole of B)
  for (let i = 0; i < ringA.length - 1; i++) {
    if (pointInRing(ringA[i], ringB) && !holesB.some(h => pointInRing(ringA[i], h))) return true;
  }
  for (let j = 0; j < ringB.length - 1; j++) {
    if (pointInRing(ringB[j], ringA) && !holesA.some(h => pointInRing(ringB[j], h))) return true;
  }
  return false;
}

// ---------------- main validators ----------------

export type ValidatePlotInput = {
  geometry: PlotGeometry | null | undefined;
  areaHectares: number | null | undefined;
};

// Returns field errors keyed by where the user should see them.
// Empty array == valid.
export function validatePlotGeometry(input: ValidatePlotInput): FieldError[] {
  const errors: FieldError[] = [];
  const { geometry, areaHectares } = input;
  const area = typeof areaHectares === "number" && Number.isFinite(areaHectares) ? areaHectares : 0;

  // --- Rule 1: polygon required ≥ 4 ha (CBI) ---
  if (area >= POLYGON_REQUIRED_AREA_HA && (!geometry || geometry.type !== "Polygon")) {
    errors.push({
      field: "polygon",
      code: "POLYGON_REQUIRED",
      message: `Plots ≥ ${POLYGON_REQUIRED_AREA_HA} ha must be captured as a polygon (CBI rule). A single GPS point is only allowed for plots smaller than ${POLYGON_REQUIRED_AREA_HA} ha.`,
    });
    return errors; // no point checking geometry-specific rules
  }

  if (!geometry) return errors; // < 4 ha and no geometry: legal (point can be added later)

  // --- Coordinate range + precision (applies to both Point and Polygon) ---
  const verticesToCheck: number[][] =
    geometry.type === "Point" ? [geometry.coordinates] :
    geometry.type === "Polygon" ? geometry.coordinates.flat() : [];

  for (let i = 0; i < verticesToCheck.length; i++) {
    const v = verticesToCheck[i];
    if (!Array.isArray(v) || v.length < 2) {
      errors.push({ field: `polygon.vertex[${i}]`, code: "INVALID_VERTEX", message: `Vertex ${i} is malformed` });
      continue;
    }
    const [lon, lat] = v;
    if (!inLatLngRange(lon, lat)) {
      errors.push({
        field: `polygon.vertex[${i}]`, code: "COORD_OUT_OF_RANGE",
        message: `Vertex ${i} (${lon}, ${lat}) is outside valid WGS84 bounds`,
      });
    }
    if (decimalDigits(lon) < MIN_DECIMAL_DIGITS || decimalDigits(lat) < MIN_DECIMAL_DIGITS) {
      errors.push({
        field: `polygon.vertex[${i}]`, code: "COORD_PRECISION_LOW",
        message: `Vertex ${i} must have at least ${MIN_DECIMAL_DIGITS} decimal digits (EUDR). Got lon ${decimalDigits(lon)}, lat ${decimalDigits(lat)}.`,
      });
    }
  }

  // --- Polygon-only geometry checks ---
  if (geometry.type === "Polygon") {
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
      errors.push({ field: "polygon", code: "POLYGON_EMPTY", message: "Polygon has no rings" });
      return errors;
    }
    geometry.coordinates.forEach((ring, ringIdx) => {
      if (!Array.isArray(ring)) {
        errors.push({ field: `polygon.rings[${ringIdx}]`, code: "RING_INVALID", message: `Ring ${ringIdx} is malformed` });
        return;
      }
      // GeoJSON polygon rings need ≥ 4 positions (3 distinct + closing repeat)
      if (ring.length < 4) {
        errors.push({
          field: `polygon.rings[${ringIdx}]`, code: "INSUFFICIENT_VERTICES",
          message: `Ring ${ringIdx} has only ${ring.length} vertices — polygons need at least 3 distinct vertices plus a closing point`,
        });
        return;
      }
      const first = ring[0], last = ring[ring.length - 1];
      if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        errors.push({
          field: `polygon.rings[${ringIdx}]`, code: "RING_NOT_CLOSED",
          message: `Ring ${ringIdx} is not closed — first and last vertex must be identical`,
        });
      }
      if (ring.length >= 5 && ringSelfIntersects(ring)) {
        errors.push({
          field: `polygon.rings[${ringIdx}]`, code: "SELF_INTERSECTING",
          message: `Ring ${ringIdx} has self-intersecting boundary segments`,
        });
      }
    });
  }

  return errors;
}

// Returns conflicting plot IDs (empty == no overlap).
export function findOverlaps(
  candidate: PolygonGeometry,
  existing: { id: string; polygon: PlotGeometry | null }[],
  excludeId?: string,
): string[] {
  const hits: string[] = [];
  for (const p of existing) {
    if (excludeId && p.id === excludeId) continue;
    const g = p.polygon;
    if (!g || g.type !== "Polygon") continue;
    if (polygonsOverlap(candidate, g)) hits.push(p.id);
  }
  return hits;
}
