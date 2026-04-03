/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cesium coordinate bridge — ECEF-native using Cesium's own math.
 *
 * KEY INSIGHT: Previous attempts used approximate geodetic conversions
 * (meters-per-degree) which drift during orbit. The correct approach:
 *
 *   1. Compute model origin in WGS84 once (via proj4)
 *   2. Build an ENU→ECEF transform at that point using Cesium's own math
 *   3. Each frame, express the IFC camera in ENU relative to model origin
 *   4. Transform ENU→ECEF using Cesium's matrix (exact, no approximation)
 *   5. Set the Cesium camera directly from the ECEF position + orientation
 *
 * This uses Cesium's Transforms.eastNorthUpToFixedFrame which is
 * mathematically exact on the WGS84 ellipsoid — no drift possible.
 */

import proj4 from 'proj4';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo } from '@ifc-lite/geometry';
import { resolveProjection } from './reproject';

export interface GeodesicPosition {
  longitude: number;
  latitude: number;
  height: number;
}

export interface CesiumBridge {
  modelOrigin: GeodesicPosition;
  rotationAngle: number;

  /**
   * Sync the Cesium camera to match the IFC viewer camera.
   * Takes the Cesium module, viewer, and IFC camera state.
   * Uses Cesium's own ECEF math for exact positioning.
   */
  syncCamera(
    Cesium: typeof import('cesium'),
    viewer: InstanceType<typeof import('cesium').Viewer>,
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
    camUp: { x: number; y: number; z: number },
    fov: number,
  ): void;

  viewerToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null;
}

/**
 * Pre-computed linear transform from viewer space to ENU at model origin.
 * This is a pure rotation+scale (no translation) applied to DELTA vectors.
 */
interface ViewerToENU {
  /** Transform a viewer delta (dvx, dvy, dvz) → (east, north, up) */
  delta(dvx: number, dvy: number, dvz: number): [number, number, number];
}

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

  // Viewer offset recovery
  const shift = coordinateInfo?.originShift ?? { x: 0, y: 0, z: 0 };
  const rtc = coordinateInfo?.wasmRtcOffset;
  const rtcYup = rtc
    ? { x: rtc.x, y: rtc.z, z: -rtc.y }
    : { x: 0, y: 0, z: 0 };

  // Model center in viewer space
  const bounds = coordinateInfo?.originalBounds;
  const modelVX = bounds ? (bounds.min.x + bounds.max.x) / 2 : 0;
  const modelVY = bounds ? (bounds.min.y + bounds.max.y) / 2 : 0;
  const modelVZ = bounds ? (bounds.min.z + bounds.max.z) / 2 : 0;

  // ── Build viewer→ENU delta transform ──
  // Pipeline: viewer Y-up → IFC Z-up → Helmert rotate → ENU
  const viewerToENU: ViewerToENU = {
    delta(dvx: number, dvy: number, dvz: number): [number, number, number] {
      // Viewer Y-up → IFC Z-up: ifcX = vx, ifcY = -vz, ifcZ = vy
      const ifcDx = dvx;
      const ifcDy = -dvz;
      const ifcDz = dvy;
      // Helmert rotation (IFC XY → East/North)
      const east = hScale * (absc * ifcDx - ordi * ifcDy);
      const north = hScale * (ordi * ifcDx + absc * ifcDy);
      const up = ifcDz;
      return [east, north, up];
    },
  };

  // ── Compute model origin in WGS84 ──
  // Full pipeline for origin point (uses proj4 once)
  const owx = modelVX + shift.x + rtcYup.x;
  const owy = modelVY + shift.y + rtcYup.y;
  const owz = modelVZ + shift.z + rtcYup.z;
  const [oIfcX, oIfcY, oIfcZ] = [owx, -owz, owy]; // viewer→IFC
  const oEasting = mapConversion.eastings + hScale * (absc * oIfcX - ordi * oIfcY);
  const oNorthing = mapConversion.northings + hScale * (ordi * oIfcX + absc * oIfcY);
  const oHeight = mapConversion.orthogonalHeight + oIfcZ;

  let originLon: number, originLat: number;
  try {
    const [lon, lat] = proj4(projDef, 'WGS84', [oEasting, oNorthing]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    originLon = lon;
    originLat = lat;
  } catch {
    return null;
  }

  const modelOrigin: GeodesicPosition = {
    longitude: originLon,
    latitude: originLat,
    height: oHeight,
  };

  // ── Cache for ECEF objects (created lazily when Cesium is available) ──
  let enuToEcefMatrix: InstanceType<typeof import('cesium').Matrix4> | null = null;
  let modelOriginCartesian: InstanceType<typeof import('cesium').Cartesian3> | null = null;

  function ensureEcefCache(Cesium: typeof import('cesium')) {
    if (!modelOriginCartesian) {
      modelOriginCartesian = Cesium.Cartesian3.fromDegrees(
        originLon, originLat, oHeight,
      );
      enuToEcefMatrix = Cesium.Transforms.eastNorthUpToFixedFrame(
        modelOriginCartesian,
      );
    }
  }

  /**
   * Sync the Cesium camera using ECEF math.
   * This converts the IFC camera to ENU, then uses Cesium's own
   * ENU→ECEF transform to get exact ECEF positions.
   * Also syncs the frustum (FOV) so the projection matches exactly.
   */
  function syncCamera(
    Cesium: typeof import('cesium'),
    viewer: InstanceType<typeof import('cesium').Viewer>,
    camPos: { x: number; y: number; z: number },
    camTarget: { x: number; y: number; z: number },
    camUp: { x: number; y: number; z: number },
    fov: number,
  ): void {
    ensureEcefCache(Cesium);
    if (!enuToEcefMatrix) return;

    // Camera position offset from model center → ENU → ECEF
    const [pE, pN, pU] = viewerToENU.delta(
      camPos.x - modelVX, camPos.y - modelVY, camPos.z - modelVZ,
    );
    const posECEF = Cesium.Matrix4.multiplyByPoint(
      enuToEcefMatrix, new Cesium.Cartesian3(pE, pN, pU), new Cesium.Cartesian3(),
    );

    // View direction (target - position) as a delta vector → ENU → ECEF direction
    const dirViewerX = camTarget.x - camPos.x;
    const dirViewerY = camTarget.y - camPos.y;
    const dirViewerZ = camTarget.z - camPos.z;
    const [dE, dN, dU] = viewerToENU.delta(dirViewerX, dirViewerY, dirViewerZ);
    const dirECEF = Cesium.Matrix4.multiplyByPointAsVector(
      enuToEcefMatrix, new Cesium.Cartesian3(dE, dN, dU), new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(dirECEF, dirECEF);

    // Up vector → ENU → ECEF
    const [uE, uN, uU] = viewerToENU.delta(camUp.x, camUp.y, camUp.z);
    const upECEF = Cesium.Matrix4.multiplyByPointAsVector(
      enuToEcefMatrix, new Cesium.Cartesian3(uE, uN, uU), new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(upECEF, upECEF);

    // Sync frustum FOV BEFORE setting view so projection matches exactly.
    const frustum = viewer.camera.frustum;
    if (frustum instanceof Cesium.PerspectiveFrustum) {
      frustum.fov = fov;
    }

    // Use setView for atomic camera update — avoids intermediate states
    // that could trigger Cesium's internal camera adjustments.
    viewer.camera.setView({
      destination: posECEF,
      orientation: {
        direction: dirECEF,
        up: upECEF,
      },
    });

    viewer.scene.requestRender();
  }

  function viewerToGeodetic(vx: number, vy: number, vz: number): GeodesicPosition | null {
    const wx = vx + shift.x + rtcYup.x;
    const wy = vy + shift.y + rtcYup.y;
    const wz = vz + shift.z + rtcYup.z;
    const [ifcX, ifcY, ifcZ] = [wx, -wz, wy];
    const easting = mapConversion.eastings + hScale * (absc * ifcX - ordi * ifcY);
    const northing = mapConversion.northings + hScale * (ordi * ifcX + absc * ifcY);
    const height = mapConversion.orthogonalHeight + ifcZ;
    try {
      const [lon, lat] = proj4(projDef!, 'WGS84', [easting, northing]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { longitude: lon, latitude: lat, height };
    } catch {
      return null;
    }
  }

  return {
    modelOrigin,
    rotationAngle: rotAngle,
    syncCamera,
    viewerToGeodetic,
  };
}
