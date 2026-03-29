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
 * Uses proj4js for the heavy lifting. Projection definitions are resolved
 * in order:
 *   1. proj4 built-in (WGS84, etc.)
 *   2. Programmatically constructed (UTM zones)
 *   3. Fetched from epsg.io at runtime (arbitrary codes)
 */

import proj4 from 'proj4';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';

export interface LatLon {
  lat: number;
  lon: number;
}

// Cache fetched projection definitions so we only hit epsg.io once per code.
const projDefCache = new Map<string, string | null>();

/**
 * Build a proj4 definition string for a UTM zone.
 * Handles zones like "32N", "10S", "60N", etc.
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
 * Try to derive a proj4 definition string from structured CRS metadata
 * without hitting the network.
 */
function tryLocalResolve(crs: ProjectedCRS): string | null {
  const name = crs.name?.toUpperCase() ?? '';

  // Direct UTM zone from mapZone field
  if (crs.mapZone) {
    const def = utmProj4String(crs.mapZone);
    if (def) return def;
  }

  // Try to extract UTM zone from description / name (e.g. "WGS 84 / UTM zone 32N")
  const utmMatch = name.match(/UTM\s+ZONE\s+(\d{1,2}[NS])/i)
    ?? crs.description?.match(/UTM\s+zone\s+(\d{1,2}[NS])/i);
  if (utmMatch) {
    const def = utmProj4String(utmMatch[1]);
    if (def) return def;
  }

  return null;
}

/**
 * Fetch a proj4 definition string from epsg.io for an EPSG code.
 */
async function fetchProj4Def(epsgCode: string): Promise<string | null> {
  if (projDefCache.has(epsgCode)) return projDefCache.get(epsgCode) ?? null;

  try {
    const resp = await fetch(`https://epsg.io/${epsgCode}.proj4`);
    if (!resp.ok) {
      projDefCache.set(epsgCode, null);
      return null;
    }
    const text = (await resp.text()).trim();
    if (!text || text.startsWith('<') || text.startsWith('{')) {
      // Got HTML or JSON error page instead of a proj4 string
      projDefCache.set(epsgCode, null);
      return null;
    }
    projDefCache.set(epsgCode, text);
    return text;
  } catch {
    projDefCache.set(epsgCode, null);
    return null;
  }
}

/**
 * Extract EPSG numeric code from a CRS name like "EPSG:32632".
 */
function extractEpsgCode(crs: ProjectedCRS): string | null {
  const match = crs.name?.match(/EPSG[:\s]*(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Resolve a proj4 definition for the given ProjectedCRS.
 * Tries local heuristics first, then falls back to epsg.io.
 */
export async function resolveProjection(crs: ProjectedCRS): Promise<string | null> {
  // 1. Try local heuristic (UTM zones)
  const local = tryLocalResolve(crs);
  if (local) return local;

  // 2. Fetch from epsg.io
  const code = extractEpsgCode(crs);
  if (code) return fetchProj4Def(code);

  return null;
}

/**
 * Reproject an IfcMapConversion origin point from the source CRS to WGS84.
 *
 * Returns { lat, lon } or null if projection cannot be resolved.
 */
export async function reprojectToLatLon(
  conversion: MapConversion,
  crs: ProjectedCRS,
): Promise<LatLon | null> {
  const projDef = await resolveProjection(crs);
  if (!projDef) return null;

  try {
    const [lon, lat] = proj4(projDef, 'WGS84', [conversion.eastings, conversion.northings]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // Sanity-check geographic bounds
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}
