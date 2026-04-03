/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cesium coordinate bridge.
 *
 * Converts IFC viewer camera coordinates (Y-up) to WGS84 geodetic coordinates
 * suitable for CesiumJS camera synchronization.
 *
 * Coordinate pipeline:
 *   Viewer Y-up (scene-local)
 *     → undo originShift + wasmRtcOffset → IFC world Y-up
 *     → Y-up to Z-up → IFC local (Z-up)
 *     → Helmert (MapConversion: rotate + scale + translate) → Projected CRS
 *     → proj4 → WGS84 (lat/lon)
 *     → geodetic height from orthogonalHeight
 */

import proj4 from 'proj4';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo } from '@ifc-lite/geometry';
import { resolveProjection } from './reproject';

export interface GeodesicPosition {
  longitude: number; // degrees
  latitude: number;  // degrees
  height: number;    // meters above ellipsoid (approx)
}

export interface CesiumCameraState {
  position: GeodesicPosition;
  heading: number;   // radians, 0 = north, clockwise
  pitch: number;     // radians, negative = looking down
  roll: number;      // radians
}

/**
 * Pre-resolved projection state. Call `createCesiumBridge` once when georef
 * data becomes available, then use the returned `bridge` on every frame.
 */
export interface CesiumBridge {
  /** Convert a viewer Y-up position to WGS84 geodetic coordinates. */
  viewerToGeodetic(viewerX: number, viewerY: number, viewerZ: number): GeodesicPosition | null;

  /** Convert the full camera state (position + orientation) to Cesium camera params. */
  viewerCameraToCesium(
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
    camUp: { x: number; y: number; z: number },
  ): CesiumCameraState | null;

  /** The model origin in WGS84 (center of bounding box). */
  modelOrigin: GeodesicPosition;

  /** The IFC rotation angle relative to grid north (radians, CCW from east). */
  rotationAngle: number;
}

/**
 * Create a reusable bridge for converting viewer coordinates to WGS84.
 * Returns null if the projection cannot be resolved.
 */
export async function createCesiumBridge(
  mapConversion: MapConversion,
  projectedCRS: ProjectedCRS,
  coordinateInfo?: CoordinateInfo,
): Promise<CesiumBridge | null> {
  const projDef = await resolveProjection(projectedCRS);
  if (!projDef) return null;

  // Pre-compute constants from MapConversion
  const scale = mapConversion.scale ?? 1.0;
  const abscissa = mapConversion.xAxisAbscissa ?? 1.0;
  const ordinate = mapConversion.xAxisOrdinate ?? 0.0;
  const rotAngle = Math.atan2(ordinate, abscissa); // radians, CCW from map-east

  // Origin shift and RTC offset for undoing viewer transforms
  const shift = coordinateInfo?.originShift ?? { x: 0, y: 0, z: 0 };
  const rtc = coordinateInfo?.wasmRtcOffset;
  // Convert WASM RTC offset from IFC Z-up to viewer Y-up
  const rtcYup = rtc
    ? { x: rtc.x, y: rtc.z, z: -rtc.y }
    : { x: 0, y: 0, z: 0 };

  /**
   * Convert viewer Y-up position to projected CRS coordinates (easting, northing, height).
   */
  function viewerToProjected(vx: number, vy: number, vz: number): { easting: number; northing: number; height: number } {
    // 1. Undo viewer transforms: scene-local + originShift + wasmRtcOffset_yup → world Y-up
    const worldYupX = vx + shift.x + rtcYup.x;
    const worldYupY = vy + shift.y + rtcYup.y;
    const worldYupZ = vz + shift.z + rtcYup.z;

    // 2. Convert Y-up to IFC Z-up: ifc_x = viewer_x, ifc_y = -viewer_z, ifc_z = viewer_y
    const ifcX = worldYupX;
    const ifcY = -worldYupZ;
    const ifcZ = worldYupY;

    // 3. Apply MapConversion Helmert transform: rotate + scale + translate
    const easting = mapConversion.eastings + scale * (abscissa * ifcX - ordinate * ifcY);
    const northing = mapConversion.northings + scale * (ordinate * ifcX + abscissa * ifcY);
    const height = mapConversion.orthogonalHeight + ifcZ;

    return { easting, northing, height };
  }

  function toGeodetic(easting: number, northing: number, height: number): GeodesicPosition | null {
    try {
      const [lon, lat] = proj4(projDef!, 'WGS84', [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      return { longitude: lon, latitude: lat, height };
    } catch {
      return null;
    }
  }

  // Compute model origin (bounds center) in WGS84
  const bounds = coordinateInfo?.originalBounds;
  let originEasting: number;
  let originNorthing: number;
  let originHeight: number;

  if (bounds) {
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cy = (bounds.min.y + bounds.max.y) / 2;
    const cz = (bounds.min.z + bounds.max.z) / 2;
    const projected = viewerToProjected(cx, cy, cz);
    originEasting = projected.easting;
    originNorthing = projected.northing;
    originHeight = projected.height;
  } else {
    originEasting = mapConversion.eastings;
    originNorthing = mapConversion.northings;
    originHeight = mapConversion.orthogonalHeight;
  }

  const modelOrigin = toGeodetic(originEasting, originNorthing, originHeight);
  if (!modelOrigin) return null;

  function viewerToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null {
    const { easting, northing, height } = viewerToProjected(vx, vy, vz);
    return toGeodetic(easting, northing, height);
  }

  /**
   * Convert IFC rotation angle to Cesium heading.
   * IFC: xAxisAbscissa/Ordinate define CCW angle from map east.
   * Cesium: heading is CW from north.
   * heading = π/2 - rotAngle
   */
  function ifcToCesiumHeading(ifcAngle: number): number {
    return Math.PI / 2 - ifcAngle;
  }

  function viewerCameraToCesium(
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
    camUp: { x: number; y: number; z: number },
  ): CesiumCameraState | null {
    const geoPos = viewerToGeodetic(camPos.x, camPos.y, camPos.z);
    if (!geoPos) return null;

    // Compute view direction in viewer space
    const dx = camTarget.x - camPos.x;
    const dy = camTarget.y - camPos.y;
    const dz = camTarget.z - camPos.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-8) return null;

    const ndx = dx / len;
    const ndy = dy / len;
    const ndz = dz / len;

    // Compute pitch (angle from horizontal plane in viewer Y-up space)
    // In viewer Y-up: horizontal plane is XZ, vertical is Y
    const horizontalLen = Math.sqrt(ndx * ndx + ndz * ndz);
    const pitch = -Math.atan2(ndy, horizontalLen); // negative = looking down in Cesium

    // Compute heading in viewer space
    // In Y-up: direction projected onto XZ plane, then convert to CW from north
    // Viewer X = IFC X (east-ish), Viewer Z = -IFC Y (south-ish in IFC)
    // atan2(x, -z) gives angle CW from IFC +Y (north-ish)
    let viewerHeading = Math.atan2(ndx, -ndz);

    // Apply the IFC-to-grid-north rotation
    const heading = viewerHeading + ifcToCesiumHeading(rotAngle);

    // Roll from up vector (simplified - assume near zero for orbit cameras)
    // Cross product of view dir and world up, compared to camera up
    const roll = 0;

    return {
      position: geoPos,
      heading: ((heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
      pitch,
      roll,
    };
  }

  return {
    viewerToGeodetic,
    viewerCameraToCesium,
    modelOrigin,
    rotationAngle: rotAngle,
  };
}
