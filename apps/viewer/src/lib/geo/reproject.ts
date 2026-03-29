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
import type { CoordinateInfo } from '@ifc-lite/geometry';
import { lookupProj4 } from '@ifc-lite/data';

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
        projDefCache.set(code, bundled);
        return bundled;
      }
      console.warn(`[reproject] EPSG:${code} found in index but has no proj4 definition`);
    } catch (err) {
      console.warn(`[reproject] Failed to load EPSG index for code ${code}:`, err);
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
    console.log(`[reproject] EPSG:${code} not in bundled index, fetching from epsg.io...`);
    const fetched = await fetchProj4Def(code);
    projDefCache.set(code, fetched);
    if (fetched) {
      console.log(`[reproject] EPSG:${code} resolved from epsg.io`);
    } else {
      console.warn(`[reproject] EPSG:${code} could not be resolved from any source`);
    }
    return fetched;
  }

  console.warn(`[reproject] No EPSG code found in CRS name: "${crs.name}"`);
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
  let ifcX = 0;
  let ifcY = 0;

  if (coordinateInfo) {
    const bounds = coordinateInfo.originalBounds;
    const shift = coordinateInfo.originShift;
    const rtc = coordinateInfo.wasmRtcOffset;

    // Convert WASM RTC offset from IFC Z-up to viewer Y-up
    const rtcYup = rtc
      ? { x: rtc.x, y: rtc.z, z: -rtc.y }
      : { x: 0, y: 0, z: 0 };

    // Bounds center in viewer Y-up (scene-local)
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;

    // World Y-up = scene_local + originShift + wasmRtcOffset_yup
    const worldYupX = cx + shift.x + rtcYup.x;
    const worldYupZ = cz + shift.z + rtcYup.z;

    // Convert Y-up to IFC Z-up: ifc_x = viewer_x, ifc_y = -viewer_z
    ifcX = worldYupX;
    ifcY = -worldYupZ;
  }

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
  const code = extractEpsgCode(crs);
  const projDef = await resolveProjection(crs);
  if (!projDef) {
    console.warn(`[reproject] Cannot resolve projection for ${crs.name}`);
    return null;
  }

  const { easting, northing } = computeProjectedCenter(conversion, coordinateInfo);
  console.log(`[reproject] EPSG:${code ?? '?'} → projected center: (${easting.toFixed(2)}, ${northing.toFixed(2)})`);

  try {
    const [lon, lat] = proj4(projDef, 'WGS84', [easting, northing]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn(`[reproject] proj4 returned non-finite: lat=${lat}, lon=${lon}`);
      return null;
    }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      console.warn(`[reproject] Coordinates out of range: lat=${lat.toFixed(5)}, lon=${lon.toFixed(5)} — MapConversion values may be inconsistent with CRS`);
      return null;
    }
    console.log(`[reproject] Result: lat=${lat.toFixed(5)}, lon=${lon.toFixed(5)}`);
    return { lat, lon };
  } catch (err) {
    console.warn(`[reproject] proj4 transform failed for EPSG:${code}:`, err);
    return null;
  }
}
