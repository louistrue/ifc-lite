/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cesium coordinate bridge — target-centric lookAt approach.
 *
 * CORE PRINCIPLE: The IFC viewer orbits around camera.target. To keep the
 * model pinned to the globe, we must make Cesium orbit around the SAME
 * world point. We do this by:
 *
 *   1. Convert camera.target to a fixed ENU offset from model origin
 *   2. Convert that to a fixed WGS84/ECEF point
 *   3. Compute distance + heading + pitch from camera.position relative to target
 *   4. Use Cesium's lookAt (HeadingPitchRange) to position the camera
 *
 * This guarantees the target point is fixed on the globe — orbit, zoom,
 * and pan all keep the model anchored to terrain.
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

export interface CesiumBridge {
  /** The model origin in WGS84. */
  modelOrigin: GeodesicPosition;

  /**
   * Convert viewer camera to Cesium lookAt parameters.
   * Returns the target in geodetic coords + heading/pitch/range.
   */
  viewerCameraToLookAt(
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
  ): {
    target: GeodesicPosition;
    heading: number;
    pitch: number;
    range: number;
  } | null;

  /** Convert a viewer Y-up position to WGS84. */
  viewerToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null;

  rotationAngle: number;
}

/**
 * Create a bridge for converting viewer coordinates to Cesium lookAt params.
 */
export async function createCesiumBridge(
  mapConversion: MapConversion,
  projectedCRS: ProjectedCRS,
  coordinateInfo?: CoordinateInfo,
): Promise<CesiumBridge | null> {
  const projDef = await resolveProjection(projectedCRS);
  if (!projDef) return null;

  // Helmert constants
  const hScale = mapConversion.scale ?? 1.0;
  const absc = mapConversion.xAxisAbscissa ?? 1.0;
  const ordi = mapConversion.xAxisOrdinate ?? 0.0;
  const rotAngle = Math.atan2(ordi, absc);

  // Offsets for undoing viewer transforms
  const shift = coordinateInfo?.originShift ?? { x: 0, y: 0, z: 0 };
  const rtc = coordinateInfo?.wasmRtcOffset;
  const rtcYup = rtc
    ? { x: rtc.x, y: rtc.z, z: -rtc.y }
    : { x: 0, y: 0, z: 0 };

  // Model center in viewer space (for origin computation)
  const bounds = coordinateInfo?.originalBounds;
  const modelVX = bounds ? (bounds.min.x + bounds.max.x) / 2 : 0;
  const modelVY = bounds ? (bounds.min.y + bounds.max.y) / 2 : 0;
  const modelVZ = bounds ? (bounds.min.z + bounds.max.z) / 2 : 0;

  // ── Axis swap: viewer Y-up → IFC Z-up ──
  // viewerX = ifcX, viewerY = ifcZ, viewerZ = -ifcY
  // So inverse: ifcX = viewerX, ifcY = -viewerZ, ifcZ = viewerY
  function viewerToIfc(vx: number, vy: number, vz: number): [number, number, number] {
    return [vx, -vz, vy];
  }

  // ── Helmert: IFC local → projected CRS ──
  function toProjected(ifcX: number, ifcY: number, ifcZ: number) {
    return {
      easting: mapConversion.eastings + hScale * (absc * ifcX - ordi * ifcY),
      northing: mapConversion.northings + hScale * (ordi * ifcX + absc * ifcY),
      height: mapConversion.orthogonalHeight + ifcZ,
    };
  }

  // ── Helmert rotation only (for direction vectors) ──
  function helmertDir(ifcDx: number, ifcDy: number): [number, number] {
    return [
      absc * ifcDx - ordi * ifcDy,  // east component
      ordi * ifcDx + absc * ifcDy,  // north component
    ];
  }

  // ── Full pipeline: viewer position → WGS84 ──
  function viewerPosToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null {
    // Undo viewer transforms
    const wx = vx + shift.x + rtcYup.x;
    const wy = vy + shift.y + rtcYup.y;
    const wz = vz + shift.z + rtcYup.z;
    const [ifcX, ifcY, ifcZ] = viewerToIfc(wx, wy, wz);
    const { easting, northing, height } = toProjected(ifcX, ifcY, ifcZ);

    try {
      const [lon, lat] = proj4(projDef!, 'WGS84', [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { longitude: lon, latitude: lat, height };
    } catch {
      return null;
    }
  }

  // Compute model origin in WGS84
  const modelOriginResult = viewerPosToGeodetic(modelVX, modelVY, modelVZ);
  if (!modelOriginResult) return null;
  const modelOrigin: GeodesicPosition = modelOriginResult;

  // Pre-compute geodetic constants for ENU offset
  const originLat = modelOrigin.latitude;
  const originLon = modelOrigin.longitude;
  const originHeight = modelOrigin.height;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos(originLat * Math.PI / 180);

  /**
   * Convert a viewer-space delta to ENU (East, North, Up) using Helmert.
   * This is linear — no proj4 — so it's stable during orbit.
   */
  function viewerDeltaToENU(dvx: number, dvy: number, dvz: number): [number, number, number] {
    const [ifcDx, ifcDy, ifcDz] = viewerToIfc(dvx, dvy, dvz);
    const [east, north] = helmertDir(ifcDx, ifcDy);
    // Apply scale to position deltas
    return [east * hScale, north * hScale, ifcDz];
  }

  /**
   * Convert a viewer-space position to geodetic using ENU offset from model origin.
   * This avoids per-point proj4 calls and is perfectly linear.
   */
  function viewerToGeodeticENU(vx: number, vy: number, vz: number): GeodesicPosition {
    const dvx = vx - modelVX;
    const dvy = vy - modelVY;
    const dvz = vz - modelVZ;
    const [east, north, up] = viewerDeltaToENU(dvx, dvy, dvz);
    return {
      latitude: originLat + north / metersPerDegLat,
      longitude: originLon + east / Math.max(metersPerDegLon, 1),
      height: originHeight + up,
    };
  }

  function viewerCameraToLookAt(
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
  ) {
    // 1. Convert the camera TARGET to a geodetic point (this is the orbit center)
    const targetGeo = viewerToGeodeticENU(camTarget.x, camTarget.y, camTarget.z);

    // 2. Compute the camera-to-target vector in ENU
    const dvx = camPos.x - camTarget.x;
    const dvy = camPos.y - camTarget.y;
    const dvz = camPos.z - camTarget.z;
    const [east, north, up] = viewerDeltaToENU(dvx, dvy, dvz);

    // 3. Range (distance from camera to target)
    const range = Math.sqrt(east * east + north * north + up * up);
    if (range < 1e-6) return null;

    // 4. Heading: angle CW from North in horizontal plane
    // atan2(east, north) = CW from North
    const heading = Math.atan2(east, north);

    // 5. Pitch: angle from horizontal
    // In Cesium HeadingPitchRange, pitch is angle from horizontal:
    // -PI/2 = looking straight down at target, 0 = horizontal
    const horizontalDist = Math.sqrt(east * east + north * north);
    const pitch = -Math.atan2(up, horizontalDist);
    // Negate because: when camera is ABOVE target (up > 0), we are looking DOWN,
    // and Cesium pitch is negative for looking down

    return {
      target: targetGeo,
      heading: ((heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
      pitch,
      range,
    };
  }

  return {
    modelOrigin,
    viewerCameraToLookAt,
    viewerToGeodetic: viewerPosToGeodetic,
    rotationAngle: rotAngle,
  };
}
