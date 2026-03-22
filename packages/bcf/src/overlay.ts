/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BCF 3D Overlay — viewer-agnostic types and position computation
 *
 * Derives 3D marker positions from BCF topics so they can be rendered
 * as floating overlays in any 3D viewer (WebGPU, Three.js, Babylon, etc.).
 *
 * Position derivation strategy (in priority order):
 *   1. Selected component bounding-box center (most accurate)
 *   2. Camera target point — the orbit center from the viewpoint (robust fallback)
 *   3. Camera viewpoint position itself (last resort)
 */

import type { BCFTopic, BCFViewpoint, BCFPoint } from './types.js';

// ============================================================================
// Core overlay types (viewer-agnostic)
// ============================================================================

/** A 3D point in the viewer's Y-up coordinate system */
export interface OverlayPoint3D {
  x: number;
  y: number;
  z: number;
}

/** Axis-aligned bounding box */
export interface OverlayBBox {
  min: OverlayPoint3D;
  max: OverlayPoint3D;
}

/**
 * A positioned 3D marker derived from a BCF topic.
 * Contains everything a renderer needs to display the marker.
 */
export interface BCFMarker3D {
  /** Topic GUID — unique identifier */
  topicGuid: string;
  /** World-space position (Y-up) where the marker should appear */
  position: OverlayPoint3D;
  /** Topic title */
  title: string;
  /** Topic status (e.g. 'Open', 'In Progress', 'Resolved', 'Closed') */
  status: string;
  /** Priority (e.g. 'High', 'Medium', 'Low') */
  priority: string;
  /** Topic type (e.g. 'Error', 'Warning', 'Info') */
  topicType: string;
  /** Number of comments */
  commentCount: number;
  /** Whether the topic has at least one viewpoint */
  hasViewpoint: boolean;
  /** Optional snapshot thumbnail (data URL) from the first viewpoint */
  snapshot?: string;
  /** How the position was derived — useful for debugging */
  positionSource: 'component' | 'camera-target' | 'camera-position';
  /** Topic index (for numbering markers) */
  index: number;
}

// ============================================================================
// Projection interface — the contract renderers must implement
// ============================================================================

/**
 * Viewer-agnostic projection interface.
 * Each renderer (WebGPU, Three.js, Babylon.js, etc.) provides an
 * implementation of this interface to enable BCF 3D overlays.
 */
export interface BCFOverlayProjection {
  /**
   * Project a world-space position to screen coordinates (pixels).
   * Returns null if the point is behind the camera.
   */
  projectToScreen(worldPos: OverlayPoint3D): { x: number; y: number } | null;

  /**
   * Get the axis-aligned bounding box for an entity by its expressId.
   * Returns null if the entity is not found.
   */
  getEntityBounds(expressId: number): OverlayBBox | null;

  /** Get the canvas/viewport dimensions in pixels */
  getCanvasSize(): { width: number; height: number };

  /**
   * Get the current camera position in world space (Y-up).
   * Used for depth-based scaling. Optional — markers render at
   * uniform size if not provided.
   */
  getCameraPosition?(): OverlayPoint3D;

  /**
   * Subscribe to camera/render changes.
   * The callback is invoked **synchronously inside the polling RAF**
   * so the overlay can re-project in the same animation frame
   * for zero-lag tracking during orbit/pan/zoom.
   * Returns an unsubscribe function.
   */
  onCameraChange(callback: () => void): () => void;
}

// ============================================================================
// Entity lookup callback type
// ============================================================================

/**
 * Callback that resolves an IFC GlobalId (22-char base64) to
 * a bounding box in Y-up viewer coordinates.
 * Returns null when the entity is not loaded or has no geometry.
 */
export type EntityBoundsLookup = (ifcGuid: string) => OverlayBBox | null;

// ============================================================================
// Position computation — internal helpers
// ============================================================================

/**
 * Convert a BCF Z-up point to the viewer's Y-up coordinate system.
 *
 * BCF (Z-up):    +X=right, +Y=forward,  +Z=up
 * Viewer (Y-up): +X=right, +Y=up,       +Z=towards viewer
 */
function bcfPointToYUp(p: BCFPoint): OverlayPoint3D {
  return { x: p.x, y: p.z, z: -p.y };
}

/**
 * Compute the camera's TARGET point (orbit center) from BCF viewpoint data.
 *
 * BCF only stores viewPoint + direction (no target distance), so we need
 * the distance from the caller. This target is the point the user was
 * looking at — a reliable anchor for the marker.
 */
function cameraTargetFromViewpoint(
  viewpoint: BCFViewpoint,
  targetDistance: number,
): OverlayPoint3D | null {
  const cam = viewpoint.perspectiveCamera ?? viewpoint.orthogonalCamera;
  if (!cam) return null;

  const origin = bcfPointToYUp(cam.cameraViewPoint);
  const dir = bcfPointToYUp(cam.cameraDirection);
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (len < 1e-6) return null;

  const nx = dir.x / len;
  const ny = dir.y / len;
  const nz = dir.z / len;

  return {
    x: origin.x + nx * targetDistance,
    y: origin.y + ny * targetDistance,
    z: origin.z + nz * targetDistance,
  };
}

/**
 * Derive a 3D marker position from a single BCF viewpoint.
 */
function positionFromViewpoint(
  viewpoint: BCFViewpoint,
  boundsLookup: EntityBoundsLookup,
  targetDistance: number,
): { position: OverlayPoint3D; source: BCFMarker3D['positionSource'] } | null {
  // Strategy 1: Selected component bounding-box center
  const selected = viewpoint.components?.selection;
  if (selected && selected.length > 0) {
    for (const comp of selected) {
      if (!comp.ifcGuid) continue;
      const bbox = boundsLookup(comp.ifcGuid);
      if (bbox) {
        return {
          position: {
            x: (bbox.min.x + bbox.max.x) / 2,
            y: bbox.max.y + (bbox.max.y - bbox.min.y) * 0.15,
            z: (bbox.min.z + bbox.max.z) / 2,
          },
          source: 'component',
        };
      }
    }
  }

  // Strategy 1b: Visible-exception components (isolation mode)
  const visibility = viewpoint.components?.visibility;
  if (visibility && !visibility.defaultVisibility && visibility.exceptions && visibility.exceptions.length > 0) {
    for (const comp of visibility.exceptions) {
      if (!comp.ifcGuid) continue;
      const bbox = boundsLookup(comp.ifcGuid);
      if (bbox) {
        return {
          position: {
            x: (bbox.min.x + bbox.max.x) / 2,
            y: bbox.max.y + (bbox.max.y - bbox.min.y) * 0.15,
            z: (bbox.min.z + bbox.max.z) / 2,
          },
          source: 'component',
        };
      }
    }
  }

  // Strategy 2: Camera target point (orbit center)
  // Uses the actual camera-to-target distance so the marker sits exactly
  // where the user was looking, not at an arbitrary distance from the camera.
  const target = cameraTargetFromViewpoint(viewpoint, targetDistance);
  if (target) {
    return { position: target, source: 'camera-target' };
  }

  // Strategy 3: Camera viewpoint position (last resort)
  const cam = viewpoint.perspectiveCamera ?? viewpoint.orthogonalCamera;
  if (cam) {
    return {
      position: bcfPointToYUp(cam.cameraViewPoint),
      source: 'camera-position',
    };
  }

  return null;
}

// ============================================================================
// Public API
// ============================================================================

export interface ComputeMarkersOptions {
  /**
   * Camera-to-target distance in world units. Used when a viewpoint has
   * camera data but no resolvable component selection. Should match the
   * viewer's camera distance (e.g. `camera.getDistance()`).
   * Default 50.
   */
  targetDistance?: number;
  /** Only include topics with these statuses (default: all) */
  statusFilter?: string[];
}

/**
 * Compute positioned 3D markers from BCF topics.
 *
 * This is a **pure function** — no DOM, no renderer dependency.
 * It takes a lookup callback so any renderer can provide entity bounds.
 *
 * @param topics       Array of BCF topics to create markers for
 * @param boundsLookup Callback to resolve IFC GlobalId → bounding box (Y-up)
 * @param options      Optional configuration
 * @returns Array of positioned markers (topics without derivable positions are skipped)
 */
export function computeMarkerPositions(
  topics: BCFTopic[],
  boundsLookup: EntityBoundsLookup,
  options?: ComputeMarkersOptions,
): BCFMarker3D[] {
  const { targetDistance = 50, statusFilter } = options ?? {};
  const markers: BCFMarker3D[] = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];

    // Status filter
    if (statusFilter && statusFilter.length > 0) {
      const s = (topic.topicStatus ?? '').toLowerCase();
      if (!statusFilter.some((f) => f.toLowerCase() === s)) continue;
    }

    // Try each viewpoint to derive a position (first valid wins)
    let result: { position: OverlayPoint3D; source: BCFMarker3D['positionSource'] } | null = null;
    for (const vp of topic.viewpoints) {
      result = positionFromViewpoint(vp, boundsLookup, targetDistance);
      if (result) break;
    }

    if (!result) continue;

    const firstVp = topic.viewpoints[0];

    markers.push({
      topicGuid: topic.guid,
      position: result.position,
      title: topic.title,
      status: topic.topicStatus ?? 'Open',
      priority: topic.priority ?? 'Normal',
      topicType: topic.topicType ?? 'Issue',
      commentCount: topic.comments.length,
      hasViewpoint: topic.viewpoints.length > 0,
      snapshot: firstVp?.snapshot,
      positionSource: result.source,
      index: topic.index ?? i + 1,
    });
  }

  return markers;
}
