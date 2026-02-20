/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry streaming hook for the 3D viewport
 * Handles mesh batching, incremental loading, dedup, camera fitting
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import { Renderer, MathUtils, type Scene, type RenderPipeline } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';

export interface UseGeometryStreamingParams {
  rendererRef: MutableRefObject<Renderer | null>;
  isInitialized: boolean;
  geometry: MeshData[] | null;
  coordinateInfo?: CoordinateInfo;
  isStreaming: boolean;
  geometryBoundsRef: MutableRefObject<{ min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }>;
  pendingColorUpdates: Map<number, [number, number, number, number]> | null;
  clearPendingColorUpdates: () => void;
  // Clear color ref — color update renders must preserve theme background
  clearColorRef: MutableRefObject<[number, number, number, number]>;
}

export function useGeometryStreaming(params: UseGeometryStreamingParams): void {
  const {
    rendererRef,
    isInitialized,
    geometry,
    coordinateInfo,
    isStreaming,
    geometryBoundsRef,
    pendingColorUpdates,
    clearPendingColorUpdates,
    clearColorRef,
  } = params;

  // Track processed meshes for incremental updates
  // Uses string keys to support compound keys (expressId:color) for submeshes
  const processedMeshIdsRef = useRef<Set<string>>(new Set());
  const lastGeometryLengthRef = useRef<number>(0);
  const lastGeometryRef = useRef<MeshData[] | null>(null);
  const cameraFittedRef = useRef<boolean>(false);
  const finalBoundsRefittedRef = useRef<boolean>(false); // Track if we've refitted after streaming

  // Render throttling during streaming
  const lastStreamRenderTimeRef = useRef<number>(0);
  const STREAM_RENDER_THROTTLE_MS = 200; // Render at most every 200ms during streaming

  useEffect(() => {
    const renderer = rendererRef.current;

    // Handle geometry cleared/null - reset refs so next load is treated as new file
    if (!geometry) {
      if (lastGeometryLengthRef.current > 0 || lastGeometryRef.current !== null) {
        // Geometry was cleared - reset tracking refs
        lastGeometryLengthRef.current = 0;
        lastGeometryRef.current = null;
        processedMeshIdsRef.current.clear();
        cameraFittedRef.current = false;
        finalBoundsRefittedRef.current = false;
        // Clear scene if renderer is ready
        if (renderer && isInitialized) {
          renderer.getScene().clear();
          renderer.getCamera().reset();
          geometryBoundsRef.current = {
            min: { x: -100, y: -100, z: -100 },
            max: { x: 100, y: 100, z: 100 },
          };
        }
      }
      return;
    }

    if (!renderer || !isInitialized) return;

    const device = renderer.getGPUDevice();
    if (!device) return;

    const scene = renderer.getScene();
    const currentLength = geometry.length;
    const lastLength = lastGeometryLengthRef.current;

    // Use length-based detection instead of reference comparison
    // React creates new array references on every appendGeometryBatch call,
    // so reference comparison would always trigger scene.clear()
    const isIncremental = currentLength > lastLength && lastLength > 0;
    const isNewFile = currentLength > 0 && lastLength === 0;
    const isCleared = currentLength === 0;

    if (isCleared) {
      // Geometry cleared (could be visibility change or file unload)
      // Clear scene but DON'T reset camera - user may just be hiding models
      scene.clear();
      processedMeshIdsRef.current.clear();
      // Keep cameraFittedRef to preserve camera position when models are shown again
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = null;
      // Note: Don't reset camera or bounds - preserve user's view
      return;
    } else if (isNewFile) {
      // New file loaded - reset camera and bounds
      scene.clear();
      processedMeshIdsRef.current.clear();
      cameraFittedRef.current = false;
      finalBoundsRefittedRef.current = false;
      lastGeometryLengthRef.current = 0;
      lastGeometryRef.current = geometry;
      // Reset camera state (clear orbit pivot, stop inertia, cancel animations)
      renderer.getCamera().reset();
      // Reset geometry bounds to default
      geometryBoundsRef.current = {
        min: { x: -100, y: -100, z: -100 },
        max: { x: 100, y: 100, z: 100 },
      };
    } else if (!isIncremental && currentLength !== lastLength) {
      // Length changed but not incremental - could be:
      // 1. Length decreased (model hidden) - DON'T reset camera
      // 2. Length increased but lastLength > 0 (new file loaded while another was open) - DO reset
      const isLengthDecrease = currentLength < lastLength;

      if (isLengthDecrease) {
        // Model visibility changed (hidden) - rebuild scene but keep camera
        scene.clear();
        processedMeshIdsRef.current.clear();
        // Don't reset cameraFittedRef - keep current camera position
        lastGeometryLengthRef.current = 0; // Reset so meshes get re-added
        lastGeometryRef.current = geometry;
        // Note: Don't reset camera or bounds - user wants to keep their view
      } else {
        // New file loaded while another was open - full reset
        scene.clear();
        processedMeshIdsRef.current.clear();
        cameraFittedRef.current = false;
        finalBoundsRefittedRef.current = false;
        lastGeometryLengthRef.current = 0;
        lastGeometryRef.current = geometry;
        // Reset camera state
        renderer.getCamera().reset();
        // Reset geometry bounds to default
        geometryBoundsRef.current = {
          min: { x: -100, y: -100, z: -100 },
          max: { x: 100, y: 100, z: 100 },
        };
      }
    } else if (currentLength === lastLength) {
      // No geometry change - but check if we need to update bounds when streaming completes
      if (cameraFittedRef.current && !isStreaming && !finalBoundsRefittedRef.current && coordinateInfo?.shiftedBounds) {
        const shiftedBounds = coordinateInfo.shiftedBounds;
        const newMaxSize = Math.max(
          shiftedBounds.max.x - shiftedBounds.min.x,
          shiftedBounds.max.y - shiftedBounds.min.y,
          shiftedBounds.max.z - shiftedBounds.min.z
        );

        if (newMaxSize > 0 && Number.isFinite(newMaxSize)) {
          // Only refit camera for LARGE models (>1000 meshes) where geometry streamed in multiple batches
          // Small models complete in one batch, so their initial camera fit is already correct
          const isLargeModel = geometry.length > 1000;

          if (isLargeModel) {
            const oldBounds = geometryBoundsRef.current;
            const oldMaxSize = Math.max(
              oldBounds.max.x - oldBounds.min.x,
              oldBounds.max.y - oldBounds.min.y,
              oldBounds.max.z - oldBounds.min.z
            );

            // Refit camera if bounds expanded significantly (>10% larger)
            // This handles skyscrapers where upper floors arrive in later batches
            const boundsExpanded = newMaxSize > oldMaxSize * 1.1;

            if (boundsExpanded) {
              renderer.getCamera().fitToBounds(shiftedBounds.min, shiftedBounds.max);
            }
          }

          // Always update bounds for accurate zoom-to-fit, home view, etc.
          geometryBoundsRef.current = { min: { ...shiftedBounds.min }, max: { ...shiftedBounds.max } };
          finalBoundsRefittedRef.current = true;
        }
      }
      return;
    }

    // For incremental batches: update reference and continue to add new meshes
    if (isIncremental) {
      lastGeometryRef.current = geometry;
    } else if (lastGeometryRef.current === null) {
      lastGeometryRef.current = geometry;
    }

    // FIX: When not streaming (type visibility toggle), new meshes can be ANYWHERE in the array,
    // not just at the end. During streaming, new meshes ARE appended, so slice is safe.
    // After streaming completes, filter changes can insert meshes at any position.
    const meshesToAdd = isStreaming
      ? geometry.slice(lastGeometryLengthRef.current)  // Streaming: new meshes at end
      : geometry;  // Post-streaming: scan entire array for unprocessed meshes

    // Filter out already processed meshes
    // NOTE: Multiple meshes can share the same expressId AND same color (e.g., door inner framing pieces),
    // so we use expressId + array index as a compound key to ensure all submeshes are processed.
    const newMeshes: MeshData[] = [];
    const startIndex = isStreaming ? lastGeometryLengthRef.current : 0;
    for (let i = 0; i < meshesToAdd.length; i++) {
      const meshData = meshesToAdd[i];
      // Use expressId + global array index as key to ensure each mesh is unique
      // (same expressId can have multiple submeshes with same color, e.g., door framing)
      const globalIndex = startIndex + i;
      const compoundKey = `${meshData.expressId}:${globalIndex}`;

      if (!processedMeshIdsRef.current.has(compoundKey)) {
        newMeshes.push(meshData);
        processedMeshIdsRef.current.add(compoundKey);
      }
    }

    if (newMeshes.length > 0) {
      // Batch meshes by color for efficient rendering (reduces draw calls from N to ~100-500)
      // This dramatically improves performance for large models (50K+ meshes)
      const pipeline = renderer.getPipeline();
      if (pipeline) {
        // Use batched rendering - groups meshes by color into single draw calls
        // Pass isStreaming flag to enable throttled batch rebuilding (reduces O(N^2) cost)
        scene.appendToBatches(newMeshes, device, pipeline, isStreaming);

        // Note: addMeshData is now called inside appendToBatches, no need to duplicate
      } else {
        // Fallback: add individual meshes if pipeline not ready
        for (const meshData of newMeshes) {
          const vertexCount = meshData.positions.length / 3;
          const interleaved = new Float32Array(vertexCount * 6);
          for (let i = 0; i < vertexCount; i++) {
            const base = i * 6;
            const posBase = i * 3;
            interleaved[base] = meshData.positions[posBase];
            interleaved[base + 1] = meshData.positions[posBase + 1];
            interleaved[base + 2] = meshData.positions[posBase + 2];
            interleaved[base + 3] = meshData.normals[posBase];
            interleaved[base + 4] = meshData.normals[posBase + 1];
            interleaved[base + 5] = meshData.normals[posBase + 2];
          }

          const vertexBuffer = device.createBuffer({
            size: interleaved.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(vertexBuffer, 0, interleaved);

          const indexBuffer = device.createBuffer({
            size: meshData.indices.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(indexBuffer, 0, meshData.indices);

          scene.addMesh({
            expressId: meshData.expressId,
            vertexBuffer,
            indexBuffer,
            indexCount: meshData.indices.length,
            transform: MathUtils.identity(),
            color: meshData.color,
          });
        }
      }

      // Invalidate caches when new geometry is added
      renderer.clearCaches();
    }

    lastGeometryLengthRef.current = currentLength;

    // Fit camera and store bounds
    // IMPORTANT: Fit camera immediately when we have valid bounds to avoid starting inside model
    // The default camera position (50, 50, 100) is inside most models that are shifted to origin
    if (!cameraFittedRef.current && coordinateInfo?.shiftedBounds) {
      const shiftedBounds = coordinateInfo.shiftedBounds;
      const maxSize = Math.max(
        shiftedBounds.max.x - shiftedBounds.min.x,
        shiftedBounds.max.y - shiftedBounds.min.y,
        shiftedBounds.max.z - shiftedBounds.min.z
      );
      // Fit camera immediately when we have valid bounds
      // For streaming: the first batch already has complete bounds from coordinate handler
      // (bounds are calculated from ALL geometry before streaming starts)
      // Waiting for streaming to complete causes the camera to start inside the model
      if (maxSize > 0 && Number.isFinite(maxSize)) {
        renderer.getCamera().fitToBounds(shiftedBounds.min, shiftedBounds.max);
        geometryBoundsRef.current = { min: { ...shiftedBounds.min }, max: { ...shiftedBounds.max } };
        cameraFittedRef.current = true;
      }
    } else if (!cameraFittedRef.current && geometry.length > 0 && !isStreaming) {
      // Fallback: calculate bounds from geometry array (only when streaming is complete)
      // This ensures we have complete bounds before fitting camera
      const fallbackBounds = {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
      };

      // Max coordinate threshold - matches CoordinateHandler's NORMAL_COORD_THRESHOLD
      // Coordinates beyond this are likely corrupted or unshifted original coordinates
      const MAX_VALID_COORD = 10000;

      for (const meshData of geometry) {
        for (let i = 0; i < meshData.positions.length; i += 3) {
          const x = meshData.positions[i];
          const y = meshData.positions[i + 1];
          const z = meshData.positions[i + 2];
          // Filter out corrupted/unshifted vertices (> 10km from origin)
          const isValid = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) &&
            Math.abs(x) < MAX_VALID_COORD && Math.abs(y) < MAX_VALID_COORD && Math.abs(z) < MAX_VALID_COORD;
          if (isValid) {
            fallbackBounds.min.x = Math.min(fallbackBounds.min.x, x);
            fallbackBounds.min.y = Math.min(fallbackBounds.min.y, y);
            fallbackBounds.min.z = Math.min(fallbackBounds.min.z, z);
            fallbackBounds.max.x = Math.max(fallbackBounds.max.x, x);
            fallbackBounds.max.y = Math.max(fallbackBounds.max.y, y);
            fallbackBounds.max.z = Math.max(fallbackBounds.max.z, z);
          }
        }
      }

      const maxSize = Math.max(
        fallbackBounds.max.x - fallbackBounds.min.x,
        fallbackBounds.max.y - fallbackBounds.min.y,
        fallbackBounds.max.z - fallbackBounds.min.z
      );

      if (fallbackBounds.min.x !== Infinity && maxSize > 0 && Number.isFinite(maxSize)) {
        renderer.getCamera().fitToBounds(fallbackBounds.min, fallbackBounds.max);
        geometryBoundsRef.current = fallbackBounds;
        cameraFittedRef.current = true;
      }
    }

    // Note: Background instancing conversion removed
    // Regular MeshData meshes are rendered directly with their correct positions
    // Instancing conversion would require preserving actual mesh transforms, which is complex
    // For now, we render regular meshes directly (fast enough for most cases)

    // Render throttling: During streaming, only render every STREAM_RENDER_THROTTLE_MS
    // This prevents rendering 28K+ meshes from blocking WASM batch processing
    const now = Date.now();
    const timeSinceLastRender = now - lastStreamRenderTimeRef.current;
    const shouldRender = !isStreaming || timeSinceLastRender >= STREAM_RENDER_THROTTLE_MS;

    if (shouldRender) {
      renderer.render();
      lastStreamRenderTimeRef.current = now;
    }
  }, [geometry, coordinateInfo, isInitialized, isStreaming]);

  // Force render when streaming completes (progress goes from <100% to 100% or null)
  const prevIsStreamingRef = useRef(isStreaming);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !isInitialized) return;

    // If streaming just completed (was streaming, now not), rebuild pending batches and render
    if (prevIsStreamingRef.current && !isStreaming) {
      const device = renderer.getGPUDevice();
      const pipeline = renderer.getPipeline();
      const scene = renderer.getScene();

      // Rebuild any pending batches that were deferred during streaming
      if (device && pipeline && scene.hasPendingBatches()) {
        scene.rebuildPendingBatches(device, pipeline);
      }

      renderer.render();
      lastStreamRenderTimeRef.current = Date.now();
    }
    prevIsStreamingRef.current = isStreaming;
  }, [isStreaming, isInitialized]);

  // Apply pending color updates as overlay batches (lens coloring).
  // Uses scene.setColorOverrides() which builds overlay batches rendered on top
  // of original geometry via depthCompare 'equal'. Original batches are NEVER
  // modified, so clearing lens is instant (no batch rebuild).
  useEffect(() => {
    if (pendingColorUpdates === null) return;

    // Wait until viewport is initialized before applying color updates
    if (!isInitialized) return;

    const renderer = rendererRef.current;
    if (!renderer) return;

    const device = renderer.getGPUDevice();
    const pipeline = renderer.getPipeline();
    const scene = renderer.getScene();

    if (device && pipeline) {
      if (pendingColorUpdates.size === 0) {
        // Empty map = clear overrides (lens deactivated)
        scene.clearColorOverrides();
      } else {
        // Non-empty map = set color overrides
        scene.setColorOverrides(pendingColorUpdates, device, pipeline);
      }
      // Re-render with current theme background — render() without options
      // defaults to black background.  Do NOT pass hiddenIds/isolatedIds here:
      // visibility filtering causes partial batches which write depth only for
      // visible elements, but overlay batches cover all geometry.  Without
      // filtering, all original batches write depth for every entity, ensuring
      // depthCompare 'equal' matches exactly for the overlay pass.
      // The next render from useRenderUpdates will apply the correct visibility.
      renderer.render({
        clearColor: clearColorRef.current,
      });
      clearPendingColorUpdates();
    }
  }, [pendingColorUpdates, isInitialized, clearPendingColorUpdates]);
}

export default useGeometryStreaming;
