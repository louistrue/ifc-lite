/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cesium coordinate bridge — ENU (East-North-Up) local tangent plane approach.
 *
 * CRITICAL DESIGN: We do NOT independently reproject every camera position to
 * WGS84. That causes non-linear distortion during orbit because proj4 is
 * non-linear over distance. Instead:
 *
 *   1. Compute the model origin in WGS84 (once)
 *   2. Build a local IFC→ENU rotation matrix (once)
 *   3. On each frame, express the camera as an ENU offset from the model origin
 *   4. Convert that ENU offset to Cesium ECEF using Cesium's own math
 *
 * This guarantees the model stays fixed in world space during orbit/pan/zoom.
 *
 * IFC viewer coordinate pipeline:
 *   Scene-local (Y-up)
 *     + originShift + wasmRtcOffset → IFC world (Y-up)
 *     → swap axes → IFC local (Z-up)
 *     → Helmert (rotate + scale) → aligned with projected CRS axes
 *     → ENU rotation → East/North/Up
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
  /** Camera position in WGS84 */
  position: GeodesicPosition;
  /** Heading in radians, 0 = north, CW */
  heading: number;
  /** Pitch in radians, negative = looking down */
  pitch: number;
  /** Roll in radians */
  roll: number;
}

export interface CesiumBridge {
  /** The model origin in WGS84 (center of bounding box). */
  modelOrigin: GeodesicPosition;

  /**
   * Convert viewer camera state to Cesium camera parameters.
   * Uses ENU offset from model origin for precision.
   */
  viewerCameraToCesium(
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
    camUp: { x: number; y: number; z: number },
  ): CesiumCameraState | null;

  /** Convert a viewer Y-up position to WGS84 (for occasional use, not per-frame). */
  viewerToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null;

  /** The IFC rotation angle (radians, CCW from east). */
  rotationAngle: number;
}

/**
 * Create a bridge for converting viewer coordinates to Cesium camera params.
 * Returns null if the projection cannot be resolved.
 */
export async function createCesiumBridge(
  mapConversion: MapConversion,
  projectedCRS: ProjectedCRS,
  coordinateInfo?: CoordinateInfo,
): Promise<CesiumBridge | null> {
  const projDef = await resolveProjection(projectedCRS);
  if (!projDef) return null;

  // Pre-compute Helmert constants from MapConversion
  const helmertScale = mapConversion.scale ?? 1.0;
  const abscissa = mapConversion.xAxisAbscissa ?? 1.0;
  const ordinate = mapConversion.xAxisOrdinate ?? 0.0;
  const rotAngle = Math.atan2(ordinate, abscissa); // IFC rotation CCW from map-east

  // Origin shift and RTC offset for undoing viewer transforms
  const shift = coordinateInfo?.originShift ?? { x: 0, y: 0, z: 0 };
  const rtc = coordinateInfo?.wasmRtcOffset;
  // Convert WASM RTC offset from IFC Z-up to viewer Y-up
  const rtcYup = rtc
    ? { x: rtc.x, y: rtc.z, z: -rtc.y }
    : { x: 0, y: 0, z: 0 };

  // ─── Pre-compute: model origin in projected CRS and WGS84 ─────────────

  // Compute model center in viewer space
  const bounds = coordinateInfo?.originalBounds;
  const modelViewerX = bounds ? (bounds.min.x + bounds.max.x) / 2 : 0;
  const modelViewerY = bounds ? (bounds.min.y + bounds.max.y) / 2 : 0;
  const modelViewerZ = bounds ? (bounds.min.z + bounds.max.z) / 2 : 0;

  /**
   * Convert viewer Y-up delta to IFC Z-up delta (no translation, just axis swap).
   * viewer(x,y,z) Y-up → ifc(x,-z,y) Z-up
   */
  function viewerToIfcDelta(vx: number, vy: number, vz: number): [number, number, number] {
    return [vx, -vz, vy];
  }

  /**
   * Convert viewer Y-up position to IFC Z-up world coordinates (with offsets).
   */
  function viewerToIfcWorld(vx: number, vy: number, vz: number): [number, number, number] {
    const wx = vx + shift.x + rtcYup.x;
    const wy = vy + shift.y + rtcYup.y;
    const wz = vz + shift.z + rtcYup.z;
    return viewerToIfcDelta(wx, wy, wz);
  }

  /**
   * Apply Helmert transform (rotate + scale, no translate) to an IFC delta vector.
   * Returns [easting_delta, northing_delta].
   */
  function helmertDelta(ifcDx: number, ifcDy: number): [number, number] {
    return [
      helmertScale * (abscissa * ifcDx - ordinate * ifcDy),
      helmertScale * (ordinate * ifcDx + abscissa * ifcDy),
    ];
  }

  /**
   * Apply full Helmert transform (rotate + scale + translate) to get absolute projected coords.
   */
  function helmertFull(ifcX: number, ifcY: number, ifcZ: number): { easting: number; northing: number; height: number } {
    const [de, dn] = helmertDelta(ifcX, ifcY);
    return {
      easting: mapConversion.eastings + de,
      northing: mapConversion.northings + dn,
      height: mapConversion.orthogonalHeight + ifcZ,
    };
  }

  // Compute model origin in projected CRS
  const [originIfcX, originIfcY, originIfcZ] = viewerToIfcWorld(modelViewerX, modelViewerY, modelViewerZ);
  const originProjected = helmertFull(originIfcX, originIfcY, originIfcZ);

  // Compute model origin in WGS84
  let modelOriginLon: number;
  let modelOriginLat: number;
  try {
    const [lon, lat] = proj4(projDef, 'WGS84', [originProjected.easting, originProjected.northing]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    modelOriginLon = lon;
    modelOriginLat = lat;
  } catch {
    return null;
  }

  const modelOrigin: GeodesicPosition = {
    longitude: modelOriginLon,
    latitude: modelOriginLat,
    height: originProjected.height,
  };

  // ─── Pre-compute: rotation from IFC-aligned projected CRS to true ENU ──
  // In projected CRS (e.g. UTM), X = Easting = East, Y = Northing = North.
  // The Helmert transform already aligns IFC to projected CRS.
  // So after Helmert, the projected delta is already in (East, North) directions.
  // The viewer-to-ENU pipeline for a DELTA vector is:
  //   viewer delta (Y-up) → IFC delta (Z-up) → Helmert delta → (East, North, Up)

  /**
   * Convert a viewer-space delta vector to ENU (East, North, Up).
   * This is the core transform for camera sync — it preserves
   * the angular relationship during orbit because it's a single
   * linear rotation (no non-linear proj4 per-point reprojection).
   */
  function viewerDeltaToENU(dvx: number, dvy: number, dvz: number): [number, number, number] {
    // 1. Viewer Y-up delta → IFC Z-up delta
    const [ifcDx, ifcDy, ifcDz] = viewerToIfcDelta(dvx, dvy, dvz);

    // 2. Apply Helmert rotation+scale (just XY, Z passes through)
    const [east, north] = helmertDelta(ifcDx, ifcDy);

    // 3. IFC Z (height) maps to Up
    const up = ifcDz;

    return [east, north, up];
  }

  /**
   * Convert viewer camera to Cesium camera params using ENU offsets.
   *
   * Instead of reprojecting the camera position independently (which causes
   * non-linear drift during orbit), we:
   *   1. Express camera position as offset from model center in viewer space
   *   2. Transform that offset to ENU using a single linear rotation
   *   3. Add the ENU offset to the model's known ECEF position in Cesium
   */
  function viewerCameraToCesium(
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
    _camUp: { x: number; y: number; z: number },
  ): CesiumCameraState | null {
    // Camera offset from model center in viewer space
    const dvx = camPos.x - modelViewerX;
    const dvy = camPos.y - modelViewerY;
    const dvz = camPos.z - modelViewerZ;

    // Convert to ENU offset
    const [east, north, up] = viewerDeltaToENU(dvx, dvy, dvz);

    // Camera position = modelOrigin + ENU offset
    // Convert ENU offset to approximate geodetic offset:
    //   1 degree latitude ≈ 111,320 m
    //   1 degree longitude ≈ 111,320 * cos(lat) m
    const metersPerDegLat = 111320;
    const metersPerDegLon = 111320 * Math.cos(modelOriginLat * Math.PI / 180);

    const camGeo: GeodesicPosition = {
      latitude: modelOriginLat + north / metersPerDegLat,
      longitude: modelOriginLon + east / Math.max(metersPerDegLon, 1),
      height: modelOrigin.height + up,
    };

    // ── Heading ──
    // View direction in viewer space
    const dirX = camTarget.x - camPos.x;
    const dirY = camTarget.y - camPos.y;
    const dirZ = camTarget.z - camPos.z;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
    if (dirLen < 1e-8) return null;

    // Convert view direction to ENU
    const [viewEast, viewNorth, viewUp] = viewerDeltaToENU(
      dirX / dirLen,
      dirY / dirLen,
      dirZ / dirLen,
    );

    // Heading = angle CW from North in the horizontal (East-North) plane
    // atan2(east, north) gives CW from North
    const heading = Math.atan2(viewEast, viewNorth);

    // Pitch = angle from horizontal
    const horizontalLen = Math.sqrt(viewEast * viewEast + viewNorth * viewNorth);
    const pitch = Math.atan2(viewUp, horizontalLen) - Math.PI / 2;
    // Cesium pitch: 0 = horizontal, -PI/2 = looking straight down

    return {
      position: camGeo,
      heading: ((heading % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI),
      pitch,
      roll: 0,
    };
  }

  function viewerToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null {
    const [ifcX, ifcY, ifcZ] = viewerToIfcWorld(vx, vy, vz);
    const { easting, northing, height } = helmertFull(ifcX, ifcY, ifcZ);
    try {
      const [lon, lat] = proj4(projDef!, 'WGS84', [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { longitude: lon, latitude: lat, height };
    } catch {
      return null;
    }
  }

  return {
    viewerCameraToCesium,
    viewerToGeodetic,
    modelOrigin,
    rotationAngle: rotAngle,
  };
}
