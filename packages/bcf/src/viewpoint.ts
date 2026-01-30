/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Viewpoint conversion utilities
 *
 * Converts between viewer camera state and BCF viewpoint format.
 * Handles coordinate system transformations and camera parameter mapping.
 */

import type {
  BCFViewpoint,
  BCFPerspectiveCamera,
  BCFOrthogonalCamera,
  BCFClippingPlane,
  BCFPoint,
  BCFDirection,
} from './types.js';
import { generateIfcGuid } from './guid.js';

// ============================================================================
// Camera State Types (matching ifc-lite viewer)
// ============================================================================

export interface ViewerCameraState {
  /** Camera position in world coordinates */
  position: { x: number; y: number; z: number };
  /** Camera look-at target in world coordinates */
  target: { x: number; y: number; z: number };
  /** Camera up vector */
  up: { x: number; y: number; z: number };
  /** Field of view in radians */
  fov: number;
  /** Is orthographic projection */
  isOrthographic?: boolean;
  /** Orthographic scale (view-to-world) */
  orthoScale?: number;
}

export interface ViewerSectionPlane {
  /** Axis: 'down' (Y), 'front' (Z), 'side' (X) */
  axis: 'down' | 'front' | 'side';
  /** Position as percentage (0-100) of model bounds */
  position: number;
  /** Is the section plane enabled */
  enabled: boolean;
  /** Is the plane flipped */
  flipped: boolean;
}

export interface ViewerBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

// ============================================================================
// Camera Conversion
// ============================================================================

/**
 * Convert viewer camera state to BCF perspective camera
 *
 * BCF uses direction vector instead of look-at point.
 * Direction = normalize(target - position)
 */
export function cameraToPerspective(camera: ViewerCameraState): BCFPerspectiveCamera {
  // Calculate direction vector
  const dx = camera.target.x - camera.position.x;
  const dy = camera.target.y - camera.position.y;
  const dz = camera.target.z - camera.position.z;

  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const direction: BCFDirection =
    length > 0.0001
      ? { x: dx / length, y: dy / length, z: dz / length }
      : { x: 0, y: 0, z: -1 }; // Default forward

  // Normalize up vector
  const upLength = Math.sqrt(
    camera.up.x * camera.up.x + camera.up.y * camera.up.y + camera.up.z * camera.up.z
  );
  const upVector: BCFDirection =
    upLength > 0.0001
      ? { x: camera.up.x / upLength, y: camera.up.y / upLength, z: camera.up.z / upLength }
      : { x: 0, y: 1, z: 0 }; // Default up

  // Convert FOV from radians to degrees
  const fieldOfView = (camera.fov * 180) / Math.PI;

  return {
    cameraViewPoint: { ...camera.position },
    cameraDirection: direction,
    cameraUpVector: upVector,
    fieldOfView: Math.max(1, Math.min(179, fieldOfView)), // Clamp to valid range
  };
}

/**
 * Convert viewer camera state to BCF orthogonal camera
 */
export function cameraToOrthogonal(
  camera: ViewerCameraState,
  viewToWorldScale: number
): BCFOrthogonalCamera {
  // Calculate direction vector
  const dx = camera.target.x - camera.position.x;
  const dy = camera.target.y - camera.position.y;
  const dz = camera.target.z - camera.position.z;

  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const direction: BCFDirection =
    length > 0.0001
      ? { x: dx / length, y: dy / length, z: dz / length }
      : { x: 0, y: 0, z: -1 };

  // Normalize up vector
  const upLength = Math.sqrt(
    camera.up.x * camera.up.x + camera.up.y * camera.up.y + camera.up.z * camera.up.z
  );
  const upVector: BCFDirection =
    upLength > 0.0001
      ? { x: camera.up.x / upLength, y: camera.up.y / upLength, z: camera.up.z / upLength }
      : { x: 0, y: 1, z: 0 };

  return {
    cameraViewPoint: { ...camera.position },
    cameraDirection: direction,
    cameraUpVector: upVector,
    viewToWorldScale,
  };
}

/**
 * Convert BCF perspective camera to viewer camera state
 *
 * BCF stores direction, but viewers need a look-at point.
 * We compute target = position + direction * distance
 *
 * @param camera - BCF perspective camera
 * @param targetDistance - Distance from eye to target (default: 10)
 */
export function perspectiveToCamera(
  camera: BCFPerspectiveCamera,
  targetDistance = 10
): ViewerCameraState {
  const target = {
    x: camera.cameraViewPoint.x + camera.cameraDirection.x * targetDistance,
    y: camera.cameraViewPoint.y + camera.cameraDirection.y * targetDistance,
    z: camera.cameraViewPoint.z + camera.cameraDirection.z * targetDistance,
  };

  // Convert FOV from degrees to radians
  const fov = (camera.fieldOfView * Math.PI) / 180;

  return {
    position: { ...camera.cameraViewPoint },
    target,
    up: { ...camera.cameraUpVector },
    fov,
    isOrthographic: false,
  };
}

/**
 * Convert BCF orthogonal camera to viewer camera state
 */
export function orthogonalToCamera(
  camera: BCFOrthogonalCamera,
  targetDistance = 10
): ViewerCameraState {
  const target = {
    x: camera.cameraViewPoint.x + camera.cameraDirection.x * targetDistance,
    y: camera.cameraViewPoint.y + camera.cameraDirection.y * targetDistance,
    z: camera.cameraViewPoint.z + camera.cameraDirection.z * targetDistance,
  };

  return {
    position: { ...camera.cameraViewPoint },
    target,
    up: { ...camera.cameraUpVector },
    fov: Math.PI / 4, // Default FOV for ortho (not used)
    isOrthographic: true,
    orthoScale: camera.viewToWorldScale,
  };
}

// ============================================================================
// Section Plane Conversion
// ============================================================================

/**
 * Convert viewer section plane to BCF clipping plane
 *
 * ifc-lite uses percentage position (0-100) along an axis.
 * BCF uses absolute location and direction in world coordinates.
 */
export function sectionPlaneToClippingPlane(
  sectionPlane: ViewerSectionPlane,
  bounds: ViewerBounds
): BCFClippingPlane | null {
  if (!sectionPlane.enabled) {
    return null;
  }

  // Calculate absolute position from percentage
  const t = sectionPlane.position / 100;

  let location: BCFPoint;
  let direction: BCFDirection;

  switch (sectionPlane.axis) {
    case 'down': // Y axis
      location = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: bounds.min.y + t * (bounds.max.y - bounds.min.y),
        z: (bounds.min.z + bounds.max.z) / 2,
      };
      direction = sectionPlane.flipped ? { x: 0, y: 1, z: 0 } : { x: 0, y: -1, z: 0 };
      break;

    case 'front': // Z axis
      location = {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: bounds.min.z + t * (bounds.max.z - bounds.min.z),
      };
      direction = sectionPlane.flipped ? { x: 0, y: 0, z: 1 } : { x: 0, y: 0, z: -1 };
      break;

    case 'side': // X axis
      location = {
        x: bounds.min.x + t * (bounds.max.x - bounds.min.x),
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      };
      direction = sectionPlane.flipped ? { x: 1, y: 0, z: 0 } : { x: -1, y: 0, z: 0 };
      break;
  }

  return { location, direction };
}

/**
 * Convert BCF clipping plane to viewer section plane
 *
 * Determines the closest axis and calculates percentage position.
 */
export function clippingPlaneToSectionPlane(
  plane: BCFClippingPlane,
  bounds: ViewerBounds
): ViewerSectionPlane {
  const { direction } = plane;

  // Determine primary axis based on direction
  const absX = Math.abs(direction.x);
  const absY = Math.abs(direction.y);
  const absZ = Math.abs(direction.z);

  let axis: 'down' | 'front' | 'side';
  let position: number;
  let flipped: boolean;

  if (absY >= absX && absY >= absZ) {
    // Y axis dominant (down)
    axis = 'down';
    const range = bounds.max.y - bounds.min.y;
    position = range > 0 ? ((plane.location.y - bounds.min.y) / range) * 100 : 50;
    flipped = direction.y > 0;
  } else if (absZ >= absX) {
    // Z axis dominant (front)
    axis = 'front';
    const range = bounds.max.z - bounds.min.z;
    position = range > 0 ? ((plane.location.z - bounds.min.z) / range) * 100 : 50;
    flipped = direction.z > 0;
  } else {
    // X axis dominant (side)
    axis = 'side';
    const range = bounds.max.x - bounds.min.x;
    position = range > 0 ? ((plane.location.x - bounds.min.x) / range) * 100 : 50;
    flipped = direction.x > 0;
  }

  // Clamp position to valid range
  position = Math.max(0, Math.min(100, position));

  return {
    axis,
    position,
    enabled: true,
    flipped,
  };
}

// ============================================================================
// Viewpoint Factory
// ============================================================================

/**
 * Create a BCF viewpoint from viewer state
 */
export function createViewpoint(options: {
  camera: ViewerCameraState;
  sectionPlane?: ViewerSectionPlane;
  bounds?: ViewerBounds;
  snapshot?: string;
  snapshotData?: Uint8Array;
  selectedGuids?: string[];
  hiddenGuids?: string[];
  coloredGuids?: { color: string; guids: string[] }[];
}): BCFViewpoint {
  const {
    camera,
    sectionPlane,
    bounds,
    snapshot,
    snapshotData,
    selectedGuids,
    hiddenGuids,
    coloredGuids,
  } = options;

  const viewpoint: BCFViewpoint = {
    guid: generateIfcGuid(),
  };

  // Add camera
  if (camera.isOrthographic && camera.orthoScale !== undefined) {
    viewpoint.orthogonalCamera = cameraToOrthogonal(camera, camera.orthoScale);
  } else {
    viewpoint.perspectiveCamera = cameraToPerspective(camera);
  }

  // Add clipping plane
  if (sectionPlane?.enabled && bounds) {
    const clippingPlane = sectionPlaneToClippingPlane(sectionPlane, bounds);
    if (clippingPlane) {
      viewpoint.clippingPlanes = [clippingPlane];
    }
  }

  // Add snapshot
  if (snapshot) {
    viewpoint.snapshot = snapshot;
  }
  if (snapshotData) {
    viewpoint.snapshotData = snapshotData;
  }

  // Add components
  const hasSelection = selectedGuids && selectedGuids.length > 0;
  const hasHidden = hiddenGuids && hiddenGuids.length > 0;
  const hasColoring = coloredGuids && coloredGuids.length > 0;

  if (hasSelection || hasHidden || hasColoring) {
    viewpoint.components = {};

    if (hasSelection) {
      viewpoint.components.selection = selectedGuids!.map((guid) => ({ ifcGuid: guid }));
    }

    if (hasHidden) {
      viewpoint.components.visibility = {
        defaultVisibility: true,
        exceptions: hiddenGuids!.map((guid) => ({ ifcGuid: guid })),
      };
    }

    if (hasColoring) {
      viewpoint.components.coloring = coloredGuids!.map(({ color, guids }) => ({
        color,
        components: guids.map((guid) => ({ ifcGuid: guid })),
      }));
    }
  }

  return viewpoint;
}

/**
 * Extract viewer state from a BCF viewpoint
 */
export function extractViewpointState(
  viewpoint: BCFViewpoint,
  bounds?: ViewerBounds,
  targetDistance = 10
): {
  camera?: ViewerCameraState;
  sectionPlane?: ViewerSectionPlane;
  selectedGuids: string[];
  hiddenGuids: string[];
  coloredGuids: { color: string; guids: string[] }[];
} {
  let camera: ViewerCameraState | undefined;
  let sectionPlane: ViewerSectionPlane | undefined;

  // Extract camera
  if (viewpoint.perspectiveCamera) {
    camera = perspectiveToCamera(viewpoint.perspectiveCamera, targetDistance);
  } else if (viewpoint.orthogonalCamera) {
    camera = orthogonalToCamera(viewpoint.orthogonalCamera, targetDistance);
  }

  // Extract section plane
  if (viewpoint.clippingPlanes && viewpoint.clippingPlanes.length > 0 && bounds) {
    sectionPlane = clippingPlaneToSectionPlane(viewpoint.clippingPlanes[0], bounds);
  }

  // Extract selected GUIDs
  const selectedGuids: string[] = [];
  if (viewpoint.components?.selection) {
    for (const comp of viewpoint.components.selection) {
      if (comp.ifcGuid) {
        selectedGuids.push(comp.ifcGuid);
      }
    }
  }

  // Extract hidden GUIDs (visibility exceptions when defaultVisibility is true)
  const hiddenGuids: string[] = [];
  if (viewpoint.components?.visibility?.defaultVisibility !== false) {
    if (viewpoint.components?.visibility?.exceptions) {
      for (const comp of viewpoint.components.visibility.exceptions) {
        if (comp.ifcGuid) {
          hiddenGuids.push(comp.ifcGuid);
        }
      }
    }
  }

  // Extract colored GUIDs
  const coloredGuids: { color: string; guids: string[] }[] = [];
  if (viewpoint.components?.coloring) {
    for (const coloring of viewpoint.components.coloring) {
      const guids: string[] = [];
      for (const comp of coloring.components) {
        if (comp.ifcGuid) {
          guids.push(comp.ifcGuid);
        }
      }
      if (guids.length > 0) {
        coloredGuids.push({ color: coloring.color, guids });
      }
    }
  }

  return {
    camera,
    sectionPlane,
    selectedGuids,
    hiddenGuids,
    coloredGuids,
  };
}
