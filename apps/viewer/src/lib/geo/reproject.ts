/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Coordinate reprojection utilities.
 *
 * Converts projected coordinates (e.g. UTM eastings/northings) from an
 * IfcMapConversion + IfcProjectedCRS pair into WGS84 longitude/latitude
 * so they can be displayed on a web map.
 *
 * proj4 definitions are resolved from:
 *   1. The bundled EPSG index (@ifc-lite/data) — covers all 7000+ codes
 *   2. Programmatically constructed (UTM zones, well-known codes)
 *   3. Fetched from epsg.io at runtime as last resort
 */

import proj4 from 'proj4';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo, MeshData } from '@ifc-lite/geometry';
import { lookupProj4 } from '@ifc-lite/data';
import { SectionCutter, simplifyPolygon, polygonSignedArea } from '@ifc-lite/drawing-2d';
import type { Point2D } from '@ifc-lite/drawing-2d';

export interface LatLon {
  lat: number;
  lon: number;
}

// Cache resolved projection definitions (from any source).
const projDefCache = new Map<string, string | null>();

/**
 * Extract EPSG numeric code from a CRS name like "EPSG:32632" or "EPSG 2056".
 */
function extractEpsgCode(crs: ProjectedCRS): string | null {
  const match = crs.name?.match(/EPSG[:\s]*(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Build a proj4 definition string for a UTM zone.
 */
function utmProj4String(zone: string): string | null {
  const match = zone.match(/^(\d{1,2})([NS])$/i);
  if (!match) return null;
  const zoneNum = parseInt(match[1], 10);
  const isNorth = match[2].toUpperCase() === 'N';
  if (zoneNum < 1 || zoneNum > 60) return null;
  return `+proj=utm +zone=${zoneNum}${isNorth ? '' : ' +south'} +datum=WGS84 +units=m +no_defs`;
}

/**
 * Well-known +towgs84 approximations for datums that normally use grid files.
 * These are accurate to ~1-5m, which is sufficient for map display.
 * Grid files (like OSTN15_NTv2_OSGBtoETRS.gsb) cannot run in the browser.
 */
const DATUM_TOWGS84: Record<string, string> = {
  'airy': '+towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489',      // OSGB36 (UK)
  'clrk66': '+towgs84=-8,160,176,0,0,0,0',                                   // NAD27 (approx)
  'GRS80': '+towgs84=0,0,0,0,0,0,0',                                          // GRS80-based (NAD83≈WGS84)
  'bessel': '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7',              // DHDN (Germany)
  'intl': '+towgs84=-87,-98,-121,0,0,0,0',                                    // NZGD49 (NZ)
  'aust_SA': '+towgs84=-134,-48,149,0,0,0,0',                                 // AGD84 (Australia)
};

/**
 * Strip +nadgrids=... from a proj4 string and add a +towgs84 approximation
 * based on the ellipsoid. Grid files cannot be loaded in the browser.
 */
function sanitizeProj4(def: string): string {
  if (!def.includes('+nadgrids') || def.includes('+nadgrids=@null')) return def;

  // Extract the ellipsoid to find the right towgs84 approximation
  const ellpsMatch = def.match(/\+ellps=(\S+)/);
  const ellps = ellpsMatch?.[1] ?? '';
  const towgs84 = DATUM_TOWGS84[ellps] ?? '+towgs84=0,0,0,0,0,0,0';

  // Remove +nadgrids=... and add +towgs84
  return def.replace(/\+nadgrids=\S+/g, '').replace(/\s+/g, ' ').trim() + ' ' + towgs84;
}

/**
 * Fetch a proj4 definition string from epsg.io (last-resort fallback).
 */
async function fetchProj4Def(epsgCode: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://epsg.io/${epsgCode}.proj4`);
    if (!resp.ok) return null;
    const text = (await resp.text()).trim();
    if (!text || text.startsWith('<') || text.startsWith('{') || !text.includes('+')) {
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Resolve a proj4 definition for the given ProjectedCRS.
 *
 * Resolution order:
 *   1. Cache hit
 *   2. Bundled EPSG index (7000+ codes with proj4 strings)
 *   3. UTM zone heuristic (from CRS metadata)
 *   4. Fetch from epsg.io (network fallback)
 */
export async function resolveProjection(crs: ProjectedCRS): Promise<string | null> {
  const code = extractEpsgCode(crs);

  // 1. Check cache
  if (code && projDefCache.has(code)) {
    return projDefCache.get(code) ?? null;
  }

  // 2. Bundled EPSG index (primary source — all 7000+ codes)
  if (code) {
    try {
      const bundled = await lookupProj4(code);
      if (bundled) {
        const sanitized = sanitizeProj4(bundled);
        projDefCache.set(code, sanitized);
        return sanitized;
      }
    } catch {
      // EPSG index not loaded yet, continue to fallbacks
    }
  }

  // 3. UTM zone heuristic
  if (crs.mapZone) {
    const def = utmProj4String(crs.mapZone);
    if (def) {
      if (code) projDefCache.set(code, def);
      return def;
    }
  }
  const name = crs.name?.toUpperCase() ?? '';
  const utmMatch = name.match(/UTM\s+ZONE\s+(\d{1,2}[NS])/i)
    ?? crs.description?.match(/UTM\s+zone\s+(\d{1,2}[NS])/i);
  if (utmMatch) {
    const def = utmProj4String(utmMatch[1]);
    if (def) {
      if (code) projDefCache.set(code, def);
      return def;
    }
  }

  // 4. Network fallback — fetch from epsg.io
  if (code) {
    const raw = await fetchProj4Def(code);
    const fetched = raw ? sanitizeProj4(raw) : null;
    projDefCache.set(code, fetched);
    return fetched;
  }

  return null;
}

/**
 * Compute the model center in the projected CRS (easting, northing).
 *
 * The coordinate pipeline is:
 *   1. WASM extracts IFC positions (Z-up) and may apply RTC offset (wasmRtcOffset, Z-up)
 *   2. Mesh collector converts Z-up → Y-up: viewerX = ifcX, viewerY = ifcZ, viewerZ = -ifcY
 *   3. CoordinateHandler may apply originShift (Y-up)
 *
 * To recover IFC world coordinates (Z-up) from the viewer bounds:
 *   world_yup = bounds_center + originShift + wasmRtcOffset_as_yup
 *   ifc_x = world_yup.x,  ifc_y = -world_yup.z,  ifc_z = world_yup.y
 *
 * Then the projected CRS coordinates are:
 *   easting  = mapConversion.eastings + scale * (cos*ifc_x - sin*ifc_y)
 *   northing = mapConversion.northings + scale * (sin*ifc_x + cos*ifc_y)
 */
function computeProjectedCenter(
  conversion: MapConversion,
  coordinateInfo?: CoordinateInfo,
): { easting: number; northing: number } {
  const { ifcX, ifcY } = computeLocalIfcCenter(coordinateInfo);

  // Apply MapConversion rotation + scale + offset
  const scale = conversion.scale ?? 1.0;
  const abscissa = conversion.xAxisAbscissa ?? 1.0;
  const ordinate = conversion.xAxisOrdinate ?? 0.0;

  const easting = conversion.eastings + scale * (abscissa * ifcX - ordinate * ifcY);
  const northing = conversion.northings + scale * (ordinate * ifcX + abscissa * ifcY);

  return { easting, northing };
}

/**
 * Reproject the model center from the projected CRS to WGS84 lat/lon.
 *
 * Uses the model's actual geometry bounds + RTC offset to determine where
 * the model sits in the projected coordinate system, then reprojects to WGS84.
 *
 * @param conversion  IfcMapConversion (offset, rotation, scale)
 * @param crs         IfcProjectedCRS (EPSG code)
 * @param coordinateInfo  Geometry coordinate info with bounds and RTC offset
 */
export async function reprojectToLatLon(
  conversion: MapConversion,
  crs: ProjectedCRS,
  coordinateInfo?: CoordinateInfo,
): Promise<LatLon | null> {
  const projDef = await resolveProjection(crs);
  if (!projDef) return null;

  const { easting, northing } = computeProjectedCenter(conversion, coordinateInfo);

  try {
    const [lon, lat] = proj4(projDef, 'WGS84', [easting, northing]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/**
 * Compute the model's local IFC center offset (ifcX, ifcY) from coordinate info.
 * This is the geometry center in IFC Z-up coordinates, before MapConversion is applied.
 */
function computeLocalIfcCenter(coordinateInfo?: CoordinateInfo): { ifcX: number; ifcY: number } {
  if (!coordinateInfo) return { ifcX: 0, ifcY: 0 };

  const bounds = coordinateInfo.originalBounds;
  const shift = coordinateInfo.originShift;
  const rtc = coordinateInfo.wasmRtcOffset;

  const rtcYup = rtc
    ? { x: rtc.x, y: rtc.z, z: -rtc.y }
    : { x: 0, y: 0, z: 0 };

  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;

  const worldYupX = cx + shift.x + rtcYup.x;
  const worldYupZ = cz + shift.z + rtcYup.z;

  return { ifcX: worldYupX, ifcY: -worldYupZ };
}

/**
 * Reverse-project a WGS84 lat/lon into the IfcMapConversion eastings/northings
 * values that would place the model center at the given location.
 *
 * This accounts for the model's local geometry offset, rotation, and scale:
 *   projected = eastings + scale * (cos*ifcX - sin*ifcY)
 *   ⟹ eastings = projected - scale * (cos*ifcX - sin*ifcY)
 */
export async function reprojectFromLatLon(
  latLon: LatLon,
  crs: ProjectedCRS,
  conversion?: MapConversion,
  coordinateInfo?: CoordinateInfo,
): Promise<{ easting: number; northing: number } | null> {
  const projDef = await resolveProjection(crs);
  if (!projDef) return null;

  try {
    const [projE, projN] = proj4('WGS84', projDef, [latLon.lon, latLon.lat]);
    if (!Number.isFinite(projE) || !Number.isFinite(projN)) return null;

    // Subtract the rotated/scaled local geometry offset so that
    // the resulting eastings/northings place the model center at this position
    const { ifcX, ifcY } = computeLocalIfcCenter(coordinateInfo);
    const scale = conversion?.scale ?? 1.0;
    const abscissa = conversion?.xAxisAbscissa ?? 1.0;
    const ordinate = conversion?.xAxisOrdinate ?? 0.0;

    const easting = projE - scale * (abscissa * ifcX - ordinate * ifcY);
    const northing = projN - scale * (ordinate * ifcX + abscissa * ifcY);

    return { easting, northing };
  } catch {
    return null;
  }
}

/**
 * Extract building footprint polygon(s) from model meshes and reproject to
 * WGS84 GeoJSON coordinates for display on a web map.
 *
 * Uses the existing SectionCutter to cut meshes at ground level (Y-axis),
 * then transforms each polygon vertex through the MapConversion pipeline
 * to lat/lon coordinates.
 *
 * @returns GeoJSON-compatible coordinate rings: [lon, lat][][] (outer + holes per polygon)
 */
export async function computeFootprintGeoJSON(
  meshes: MeshData[],
  conversion: MapConversion,
  crs: ProjectedCRS,
  coordinateInfo: CoordinateInfo,
): Promise<Array<{ outer: [number, number][]; holes: [number, number][][] }> | null> {
  const projDef = await resolveProjection(crs);
  if (!projDef) return null;

  // Cut at ground level — slightly above shiftedBounds.min.y
  const groundY = coordinateInfo.shiftedBounds.min.y + 0.5;
  const cutter = new SectionCutter({ axis: 'y', position: groundY, flipped: false });
  const result = cutter.cutMeshes(meshes);

  if (result.polygons.length === 0) return null;

  // Prepare MapConversion parameters
  const scale = conversion.scale ?? 1.0;
  const abscissa = conversion.xAxisAbscissa ?? 1.0;
  const ordinate = conversion.xAxisOrdinate ?? 0.0;

  const shift = coordinateInfo.originShift;
  const rtc = coordinateInfo.wasmRtcOffset;
  const rtcYup = rtc
    ? { x: rtc.x, z: -rtc.y }
    : { x: 0, z: 0 };

  // Convert a 2D footprint point (from Y-axis section: x,z in scene-local Y-up)
  // through the full pipeline to [lon, lat].
  const pointToLonLat = (pt: Point2D): [number, number] | null => {
    // Scene-local → world Y-up
    const worldX = pt.x + shift.x + rtcYup.x;
    const worldZ = pt.y + shift.z + rtcYup.z; // Point2D.y is the Z axis for Y-cut

    // Y-up → IFC Z-up
    const ifcX = worldX;
    const ifcY = -worldZ;

    // MapConversion: local IFC → projected CRS
    const easting = conversion.eastings + scale * (abscissa * ifcX - ordinate * ifcY);
    const northing = conversion.northings + scale * (ordinate * ifcX + abscissa * ifcY);

    // Projected CRS → WGS84
    try {
      const [lon, lat] = proj4(projDef, 'WGS84', [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return [lon, lat];
    } catch {
      return null;
    }
  };

  // Sort polygons by area (largest first) and take meaningful ones
  const sorted = result.polygons
    .map(p => ({
      outer: simplifyPolygon(p.polygon.outer, 0.1),
      holes: p.polygon.holes.map(h => simplifyPolygon(h, 0.1)),
      area: Math.abs(polygonSignedArea(p.polygon.outer)),
    }))
    .filter(p => p.area > 0.5) // skip tiny fragments
    .sort((a, b) => b.area - a.area);

  if (sorted.length === 0) return null;

  // Merge all significant polygons into GeoJSON rings
  const features: Array<{ outer: [number, number][]; holes: [number, number][][] }> = [];

  for (const poly of sorted) {
    const outerCoords: [number, number][] = [];
    let valid = true;

    for (const pt of poly.outer) {
      const ll = pointToLonLat(pt);
      if (!ll) { valid = false; break; }
      outerCoords.push(ll);
    }
    if (!valid || outerCoords.length < 3) continue;

    // Close the ring (GeoJSON requirement)
    outerCoords.push(outerCoords[0]);

    const holeRings: [number, number][][] = [];
    for (const hole of poly.holes) {
      const holeCoords: [number, number][] = [];
      for (const pt of hole) {
        const ll = pointToLonLat(pt);
        if (!ll) break;
        holeCoords.push(ll);
      }
      if (holeCoords.length >= 3) {
        holeCoords.push(holeCoords[0]);
        holeRings.push(holeCoords);
      }
    }

    features.push({ outer: outerCoords, holes: holeRings });
  }

  return features.length > 0 ? features : null;
}

/**
 * Query terrain elevation at a given lat/lon using the Open-Meteo elevation API.
 * Returns height in metres above sea level, or null on failure.
 */
export async function queryTerrainElevation(latLon: LatLon): Promise<number | null> {
  try {
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${latLon.lat}&longitude=${latLon.lon}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const elev = data?.elevation?.[0];
    return typeof elev === 'number' && Number.isFinite(elev) ? elev : null;
  } catch {
    return null;
  }
}
