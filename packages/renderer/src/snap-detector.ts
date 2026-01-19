import type { MeshData } from '@ifc-lite/geometry';
import type { Ray, Vec3, Intersection } from './raycaster';
import { Raycaster } from './raycaster';

export enum SnapType {
  VERTEX = 'vertex',
  EDGE = 'edge',
  EDGE_MIDPOINT = 'edge_midpoint',
  FACE = 'face',
  FACE_CENTER = 'face_center',
}

export interface SnapTarget {
  type: SnapType;
  position: Vec3;
  normal?: Vec3;
  expressId: number;
  confidence: number; // 0-1, higher is better
  metadata?: {
    vertices?: Vec3[]; // For edges/faces
    edgeIndex?: number;
    faceIndex?: number;
  };
}

export interface SnapOptions {
  snapToVertices: boolean;
  snapToEdges: boolean;
  snapToFaces: boolean;
  snapRadius: number; // In world units
  screenSnapRadius: number; // In pixels
}

// Edge lock state for magnetic snapping (passed from store)
export interface EdgeLockInput {
  edge: { v0: Vec3; v1: Vec3 } | null;
  meshExpressId: number | null;
  lockStrength: number;
}

// Extended snap result with edge lock info
export interface MagneticSnapResult {
  snapTarget: SnapTarget | null;
  edgeLock: {
    edge: { v0: Vec3; v1: Vec3 } | null;
    meshExpressId: number | null;
    edgeT: number; // Position on edge 0-1
    shouldLock: boolean; // Whether to lock to this edge
    shouldRelease: boolean; // Whether to release current lock
    isCorner: boolean; // Is at a corner (vertex where edges meet)
    cornerValence: number; // Number of edges at corner
  };
}

// Magnetic snapping configuration constants
const MAGNETIC_CONFIG = {
  // Edge attraction zone = base radius × this multiplier
  EDGE_ATTRACTION_MULTIPLIER: 3.0,
  // Corner attraction zone = edge zone × this multiplier
  CORNER_ATTRACTION_MULTIPLIER: 2.0,
  // Confidence boost per connected edge at corner
  CORNER_CONFIDENCE_BOOST: 0.15,
  // Must move perpendicular × this factor to escape locked edge
  EDGE_ESCAPE_MULTIPLIER: 2.5,
  // Corner escape requires even more movement
  CORNER_ESCAPE_MULTIPLIER: 3.5,
  // Lock strength growth per frame while locked
  LOCK_STRENGTH_GROWTH: 0.05,
  // Maximum lock strength
  MAX_LOCK_STRENGTH: 1.5,
  // Minimum edges at vertex for corner detection
  MIN_CORNER_VALENCE: 2,
  // Distance threshold for corner detection (percentage of edge length)
  CORNER_THRESHOLD: 0.08,
};

interface MeshGeometryCache {
  vertices: Vec3[];
  edges: Array<{ v0: Vec3; v1: Vec3; index: number }>;
  // Vertex valence map: vertex key -> number of edges connected
  vertexValence: Map<string, number>;
  // Edges at each vertex: vertex key -> array of edge indices
  vertexEdges: Map<string, number[]>;
}

export class SnapDetector {
  private raycaster = new Raycaster();
  private defaultOptions: SnapOptions = {
    snapToVertices: true,
    snapToEdges: true,
    snapToFaces: true,
    snapRadius: 0.1, // 10cm in world units (meters)
    screenSnapRadius: 20, // pixels
  };

  // Cache for processed mesh geometry (vertices and edges)
  private geometryCache = new Map<number, MeshGeometryCache>();

  /**
   * Detect best snap target near cursor
   */
  detectSnapTarget(
    ray: Ray,
    meshes: MeshData[],
    intersection: Intersection | null,
    camera: { position: Vec3; fov: number },
    screenHeight: number,
    options: Partial<SnapOptions> = {}
  ): SnapTarget | null {
    const opts = { ...this.defaultOptions, ...options };

    if (!intersection) {
      return null;
    }

    const targets: SnapTarget[] = [];

    // Calculate world-space snap radius based on screen-space radius and distance
    const distanceToCamera = this.distance(camera.position, intersection.point);
    const worldSnapRadius = this.screenToWorldRadius(
      opts.screenSnapRadius,
      distanceToCamera,
      camera.fov,
      screenHeight
    );

    // Only check the intersected mesh for snap targets (performance optimization)
    // Checking all meshes was causing severe framerate drops with large models
    const intersectedMesh = meshes[intersection.meshIndex];
    if (intersectedMesh) {
      // Detect vertices
      if (opts.snapToVertices) {
        targets.push(...this.findVertices(intersectedMesh, intersection.point, worldSnapRadius));
      }

      // Detect edges
      if (opts.snapToEdges) {
        targets.push(...this.findEdges(intersectedMesh, intersection.point, worldSnapRadius));
      }

      // Detect faces
      if (opts.snapToFaces) {
        targets.push(...this.findFaces(intersectedMesh, intersection, worldSnapRadius));
      }
    }

    // Return best target
    return this.getBestSnapTarget(targets, intersection.point);
  }

  /**
   * Detect snap target with magnetic edge locking behavior
   * This provides the "stick and slide along edges" experience
   */
  detectMagneticSnap(
    ray: Ray,
    meshes: MeshData[],
    intersection: Intersection | null,
    camera: { position: Vec3; fov: number },
    screenHeight: number,
    currentEdgeLock: EdgeLockInput,
    options: Partial<SnapOptions> = {}
  ): MagneticSnapResult {
    const opts = { ...this.defaultOptions, ...options };

    // Default result when no intersection
    if (!intersection) {
      return {
        snapTarget: null,
        edgeLock: {
          edge: null,
          meshExpressId: null,
          edgeT: 0,
          shouldLock: false,
          shouldRelease: true,
          isCorner: false,
          cornerValence: 0,
        },
      };
    }

    const distanceToCamera = this.distance(camera.position, intersection.point);
    const worldSnapRadius = this.screenToWorldRadius(
      opts.screenSnapRadius,
      distanceToCamera,
      camera.fov,
      screenHeight
    );

    const intersectedMesh = meshes[intersection.meshIndex];
    if (!intersectedMesh) {
      return {
        snapTarget: null,
        edgeLock: {
          edge: null,
          meshExpressId: null,
          edgeT: 0,
          shouldLock: false,
          shouldRelease: true,
          isCorner: false,
          cornerValence: 0,
        },
      };
    }

    const cache = this.getGeometryCache(intersectedMesh);

    // If edge snapping is disabled, skip edge logic entirely
    if (!opts.snapToEdges) {
      // Just return face/vertex snap as fallback
      const targets: SnapTarget[] = [];
      if (opts.snapToFaces) {
        targets.push(...this.findFaces(intersectedMesh, intersection, worldSnapRadius));
      }
      if (opts.snapToVertices) {
        targets.push(...this.findVertices(intersectedMesh, intersection.point, worldSnapRadius));
      }
      return {
        snapTarget: this.getBestSnapTarget(targets, intersection.point),
        edgeLock: {
          edge: null,
          meshExpressId: null,
          edgeT: 0,
          shouldLock: false,
          shouldRelease: true, // Release any existing lock when edge snapping disabled
          isCorner: false,
          cornerValence: 0,
        },
      };
    }

    // Track whether we're releasing from a previous lock
    let wasLockReleased = false;

    // If we have an active edge lock, try to maintain it
    if (currentEdgeLock.edge && currentEdgeLock.meshExpressId === intersectedMesh.expressId) {
      const lockResult = this.maintainEdgeLock(
        intersection.point,
        currentEdgeLock,
        cache,
        worldSnapRadius,
        intersectedMesh.expressId
      );

      if (!lockResult.edgeLock.shouldRelease) {
        // Still locked - return the sliding position
        return lockResult;
      }
      // Lock was released - continue to find new edges but remember we released
      wasLockReleased = true;
    }

    // No active lock or lock released - find best snap target with magnetic behavior
    const edgeRadius = worldSnapRadius * MAGNETIC_CONFIG.EDGE_ATTRACTION_MULTIPLIER;
    const cornerRadius = edgeRadius * MAGNETIC_CONFIG.CORNER_ATTRACTION_MULTIPLIER;

    // Find all nearby edges
    const nearbyEdges: Array<{
      edge: { v0: Vec3; v1: Vec3; index: number };
      closestPoint: Vec3;
      distance: number;
      t: number; // Position on edge 0-1
    }> = [];

    for (const edge of cache.edges) {
      const result = this.closestPointOnEdgeWithT(intersection.point, edge.v0, edge.v1);
      if (result.distance < edgeRadius) {
        nearbyEdges.push({
          edge,
          closestPoint: result.point,
          distance: result.distance,
          t: result.t,
        });
      }
    }

    // No nearby edges - use best available snap (faces/vertices)
    if (nearbyEdges.length === 0) {
      const candidates: SnapTarget[] = [];
      if (opts.snapToFaces) {
        candidates.push(...this.findFaces(intersectedMesh, intersection, worldSnapRadius));
      }
      if (opts.snapToVertices) {
        candidates.push(...this.findVertices(intersectedMesh, intersection.point, worldSnapRadius));
      }
      return {
        snapTarget: this.getBestSnapTarget(candidates, intersection.point),
        edgeLock: {
          edge: null,
          meshExpressId: null,
          edgeT: 0,
          shouldLock: false,
          shouldRelease: wasLockReleased, // Propagate release signal from maintainEdgeLock
          isCorner: false,
          cornerValence: 0,
        },
      };
    }

    // Sort by distance - prefer closest edge
    nearbyEdges.sort((a, b) => a.distance - b.distance);
    const bestEdge = nearbyEdges[0];

    // Check if we're at a corner (near edge endpoint with high valence)
    const cornerInfo = this.detectCorner(
      bestEdge.edge,
      bestEdge.t,
      cache,
      cornerRadius,
      intersection.point
    );

    // Determine snap target
    let snapTarget: SnapTarget;

    if (cornerInfo.isCorner && cornerInfo.valence >= MAGNETIC_CONFIG.MIN_CORNER_VALENCE) {
      // Corner snap - snap to vertex
      const cornerVertex = bestEdge.t < 0.5 ? bestEdge.edge.v0 : bestEdge.edge.v1;
      snapTarget = {
        type: SnapType.VERTEX,
        position: cornerVertex,
        expressId: intersectedMesh.expressId,
        confidence: Math.min(1, 0.99 + cornerInfo.valence * MAGNETIC_CONFIG.CORNER_CONFIDENCE_BOOST),
        metadata: { vertices: [bestEdge.edge.v0, bestEdge.edge.v1] },
      };
    } else {
      // Edge snap - snap to closest point on edge
      // Check for midpoint
      const midpointDist = Math.abs(bestEdge.t - 0.5);
      if (midpointDist < 0.1) {
        // Near midpoint
        const midpoint: Vec3 = {
          x: (bestEdge.edge.v0.x + bestEdge.edge.v1.x) / 2,
          y: (bestEdge.edge.v0.y + bestEdge.edge.v1.y) / 2,
          z: (bestEdge.edge.v0.z + bestEdge.edge.v1.z) / 2,
        };
        snapTarget = {
          type: SnapType.EDGE_MIDPOINT,
          position: midpoint,
          expressId: intersectedMesh.expressId,
          confidence: 0.98,
          metadata: { vertices: [bestEdge.edge.v0, bestEdge.edge.v1], edgeIndex: bestEdge.edge.index },
        };
      } else {
        snapTarget = {
          type: SnapType.EDGE,
          position: bestEdge.closestPoint,
          expressId: intersectedMesh.expressId,
          confidence: 0.999 * (1.0 - bestEdge.distance / edgeRadius),
          metadata: { vertices: [bestEdge.edge.v0, bestEdge.edge.v1], edgeIndex: bestEdge.edge.index },
        };
      }
    }

    return {
      snapTarget,
      edgeLock: {
        edge: { v0: bestEdge.edge.v0, v1: bestEdge.edge.v1 },
        meshExpressId: intersectedMesh.expressId,
        edgeT: bestEdge.t,
        shouldLock: true,
        shouldRelease: false,
        isCorner: cornerInfo.isCorner,
        cornerValence: cornerInfo.valence,
      },
    };
  }

  /**
   * Maintain an existing edge lock - slide along edge or release if moved away
   */
  private maintainEdgeLock(
    point: Vec3,
    currentLock: EdgeLockInput,
    cache: MeshGeometryCache,
    worldSnapRadius: number,
    meshExpressId: number
  ): MagneticSnapResult {
    if (!currentLock.edge) {
      return {
        snapTarget: null,
        edgeLock: {
          edge: null,
          meshExpressId: null,
          edgeT: 0,
          shouldLock: false,
          shouldRelease: true,
          isCorner: false,
          cornerValence: 0,
        },
      };
    }

    const { v0, v1 } = currentLock.edge;

    // Project point onto the locked edge
    const result = this.closestPointOnEdgeWithT(point, v0, v1);

    // Calculate perpendicular distance (distance from point to edge line)
    const perpDistance = result.distance;

    // Calculate escape threshold based on lock strength
    const escapeMultiplier = MAGNETIC_CONFIG.EDGE_ESCAPE_MULTIPLIER * (1 + currentLock.lockStrength * 0.5);
    const escapeThreshold = worldSnapRadius * escapeMultiplier;

    // Check if we should release the lock
    if (perpDistance > escapeThreshold) {
      return {
        snapTarget: null,
        edgeLock: {
          edge: null,
          meshExpressId: null,
          edgeT: 0,
          shouldLock: false,
          shouldRelease: true,
          isCorner: false,
          cornerValence: 0,
        },
      };
    }

    // Still locked - calculate position along edge
    const edgeT = Math.max(0, Math.min(1, result.t));

    // Check for corner at current position
    const cornerRadius = worldSnapRadius * MAGNETIC_CONFIG.EDGE_ATTRACTION_MULTIPLIER * MAGNETIC_CONFIG.CORNER_ATTRACTION_MULTIPLIER;

    // Find the matching edge in cache to get proper index
    let matchingEdge = cache.edges.find(e =>
      (this.vecEquals(e.v0, v0) && this.vecEquals(e.v1, v1)) ||
      (this.vecEquals(e.v0, v1) && this.vecEquals(e.v1, v0))
    );

    const edgeForCorner = matchingEdge || { v0, v1, index: -1 };
    const cornerInfo = this.detectCorner(
      edgeForCorner,
      edgeT,
      cache,
      cornerRadius,
      point
    );

    // Calculate snap position (on the edge)
    const snapPosition: Vec3 = {
      x: v0.x + (v1.x - v0.x) * edgeT,
      y: v0.y + (v1.y - v0.y) * edgeT,
      z: v0.z + (v1.z - v0.z) * edgeT,
    };

    // Determine snap type
    let snapType: SnapType;
    let confidence: number;

    if (cornerInfo.isCorner && cornerInfo.valence >= MAGNETIC_CONFIG.MIN_CORNER_VALENCE) {
      snapType = SnapType.VERTEX;
      confidence = Math.min(1, 0.99 + cornerInfo.valence * MAGNETIC_CONFIG.CORNER_CONFIDENCE_BOOST);
      // Snap to exact corner vertex
      if (edgeT < MAGNETIC_CONFIG.CORNER_THRESHOLD) {
        snapPosition.x = v0.x;
        snapPosition.y = v0.y;
        snapPosition.z = v0.z;
      } else if (edgeT > 1 - MAGNETIC_CONFIG.CORNER_THRESHOLD) {
        snapPosition.x = v1.x;
        snapPosition.y = v1.y;
        snapPosition.z = v1.z;
      }
    } else if (Math.abs(edgeT - 0.5) < 0.08) {
      // Near midpoint
      snapType = SnapType.EDGE_MIDPOINT;
      confidence = 0.98;
      snapPosition.x = (v0.x + v1.x) / 2;
      snapPosition.y = (v0.y + v1.y) / 2;
      snapPosition.z = (v0.z + v1.z) / 2;
    } else {
      snapType = SnapType.EDGE;
      // Clamp confidence to 0-1 range (can go negative if perpDistance exceeds attraction radius)
      const rawConfidence = 0.999 * (1.0 - perpDistance / (worldSnapRadius * MAGNETIC_CONFIG.EDGE_ATTRACTION_MULTIPLIER));
      confidence = Math.max(0, Math.min(1, rawConfidence));
    }

    return {
      snapTarget: {
        type: snapType,
        position: snapPosition,
        expressId: meshExpressId,
        confidence,
        metadata: { vertices: [v0, v1] },
      },
      edgeLock: {
        edge: { v0, v1 },
        meshExpressId,
        edgeT,
        shouldLock: true,
        shouldRelease: false,
        isCorner: cornerInfo.isCorner,
        cornerValence: cornerInfo.valence,
      },
    };
  }

  /**
   * Detect if position is at a corner (vertex with multiple edges)
   */
  private detectCorner(
    edge: { v0: Vec3; v1: Vec3; index: number },
    t: number,
    cache: MeshGeometryCache,
    radius: number,
    point: Vec3
  ): { isCorner: boolean; valence: number; vertex: Vec3 | null } {
    // Check if we're near either endpoint
    const nearV0 = t < MAGNETIC_CONFIG.CORNER_THRESHOLD;
    const nearV1 = t > 1 - MAGNETIC_CONFIG.CORNER_THRESHOLD;

    if (!nearV0 && !nearV1) {
      return { isCorner: false, valence: 0, vertex: null };
    }

    const vertex = nearV0 ? edge.v0 : edge.v1;
    const vertexKey = `${vertex.x.toFixed(4)}_${vertex.y.toFixed(4)}_${vertex.z.toFixed(4)}`;

    // Get valence from cache
    const valence = cache.vertexValence.get(vertexKey) || 0;

    // Also check distance to vertex
    const distToVertex = this.distance(point, vertex);
    const isCloseEnough = distToVertex < radius;

    return {
      isCorner: isCloseEnough && valence >= MAGNETIC_CONFIG.MIN_CORNER_VALENCE,
      valence,
      vertex,
    };
  }

  /**
   * Get closest point on edge segment with parameter t (0-1)
   */
  private closestPointOnEdgeWithT(
    point: Vec3,
    v0: Vec3,
    v1: Vec3
  ): { point: Vec3; distance: number; t: number } {
    const dx = v1.x - v0.x;
    const dy = v1.y - v0.y;
    const dz = v1.z - v0.z;

    const lengthSq = dx * dx + dy * dy + dz * dz;
    if (lengthSq < 0.0000001) {
      // Degenerate edge
      return { point: v0, distance: this.distance(point, v0), t: 0 };
    }

    // Project point onto line
    const t = Math.max(0, Math.min(1,
      ((point.x - v0.x) * dx + (point.y - v0.y) * dy + (point.z - v0.z) * dz) / lengthSq
    ));

    const closest: Vec3 = {
      x: v0.x + dx * t,
      y: v0.y + dy * t,
      z: v0.z + dz * t,
    };

    return {
      point: closest,
      distance: this.distance(point, closest),
      t,
    };
  }

  /**
   * Check if two vectors are approximately equal
   */
  private vecEquals(a: Vec3, b: Vec3, epsilon: number = 0.0001): boolean {
    return (
      Math.abs(a.x - b.x) < epsilon &&
      Math.abs(a.y - b.y) < epsilon &&
      Math.abs(a.z - b.z) < epsilon
    );
  }

  /**
   * Get or compute geometry cache for a mesh
   */
  private getGeometryCache(mesh: MeshData): MeshGeometryCache {
    const cached = this.geometryCache.get(mesh.expressId);
    if (cached) {
      return cached;
    }

    // Compute and cache vertices
    const positions = mesh.positions;

    // Validate input
    if (!positions || positions.length === 0) {
      const emptyCache: MeshGeometryCache = {
        vertices: [],
        edges: [],
        vertexValence: new Map(),
        vertexEdges: new Map(),
      };
      this.geometryCache.set(mesh.expressId, emptyCache);
      return emptyCache;
    }

    const vertexMap = new Map<string, Vec3>();

    for (let i = 0; i < positions.length; i += 3) {
      const vertex: Vec3 = {
        x: positions[i],
        y: positions[i + 1],
        z: positions[i + 2],
      };

      // Skip invalid vertices
      if (!isFinite(vertex.x) || !isFinite(vertex.y) || !isFinite(vertex.z)) {
        continue;
      }

      // Use reduced precision for deduplication
      const key = `${vertex.x.toFixed(4)}_${vertex.y.toFixed(4)}_${vertex.z.toFixed(4)}`;
      vertexMap.set(key, vertex);
    }

    const vertices = Array.from(vertexMap.values());

    // Compute and cache edges + vertex valence for corner detection
    const edges: Array<{ v0: Vec3; v1: Vec3; index: number }> = [];
    const vertexValence = new Map<string, number>();
    const vertexEdges = new Map<string, number[]>();
    const indices = mesh.indices;

    if (indices) {
      const edgeMap = new Map<string, { v0: Vec3; v1: Vec3; index: number }>();

      for (let i = 0; i < indices.length; i += 3) {
        const triangleEdges = [
          [indices[i], indices[i + 1]],
          [indices[i + 1], indices[i + 2]],
          [indices[i + 2], indices[i]],
        ];

        for (const [idx0, idx1] of triangleEdges) {
          const i0 = idx0 * 3;
          const i1 = idx1 * 3;

          const v0: Vec3 = {
            x: positions[i0],
            y: positions[i0 + 1],
            z: positions[i0 + 2],
          };
          const v1: Vec3 = {
            x: positions[i1],
            y: positions[i1 + 1],
            z: positions[i1 + 2],
          };

          // Create canonical edge key (smaller index first)
          const key = idx0 < idx1 ? `${idx0}_${idx1}` : `${idx1}_${idx0}`;

          if (!edgeMap.has(key)) {
            const edgeIndex = edgeMap.size;
            edgeMap.set(key, { v0, v1, index: edgeIndex });

            // Track vertex valence (how many edges connect to each vertex)
            const v0Key = `${v0.x.toFixed(4)}_${v0.y.toFixed(4)}_${v0.z.toFixed(4)}`;
            const v1Key = `${v1.x.toFixed(4)}_${v1.y.toFixed(4)}_${v1.z.toFixed(4)}`;

            vertexValence.set(v0Key, (vertexValence.get(v0Key) || 0) + 1);
            vertexValence.set(v1Key, (vertexValence.get(v1Key) || 0) + 1);

            // Track which edges connect to each vertex
            if (!vertexEdges.has(v0Key)) vertexEdges.set(v0Key, []);
            if (!vertexEdges.has(v1Key)) vertexEdges.set(v1Key, []);
            vertexEdges.get(v0Key)!.push(edgeIndex);
            vertexEdges.get(v1Key)!.push(edgeIndex);
          }
        }
      }

      edges.push(...edgeMap.values());
    }

    const cache: MeshGeometryCache = { vertices, edges, vertexValence, vertexEdges };
    this.geometryCache.set(mesh.expressId, cache);

    return cache;
  }

  /**
   * Find vertices near point
   */
  private findVertices(mesh: MeshData, point: Vec3, radius: number): SnapTarget[] {
    const targets: SnapTarget[] = [];
    const cache = this.getGeometryCache(mesh);

    // Find vertices within radius - ONLY when VERY close for smooth edge sliding
    for (const vertex of cache.vertices) {
      const dist = this.distance(vertex, point);
      // Only snap to vertices when within 20% of snap radius (very tight) to avoid sticky behavior
      if (dist < radius * 0.2) {
        targets.push({
          type: SnapType.VERTEX,
          position: vertex,
          expressId: mesh.expressId,
          confidence: 0.95 - dist / (radius * 0.2), // Lower than edges, only wins when VERY close
        });
      }
    }

    return targets;
  }

  /**
   * Find edges near point
   */
  private findEdges(mesh: MeshData, point: Vec3, radius: number): SnapTarget[] {
    const targets: SnapTarget[] = [];
    const cache = this.getGeometryCache(mesh);

    // Use MUCH larger radius for edges - very forgiving, cursor "jumps" to edges
    const edgeRadius = radius * 3.0; // Tripled for easy detection

    // Find edges near point using cached data
    for (const edge of cache.edges) {
      const closestPoint = this.raycaster.closestPointOnSegment(point, edge.v0, edge.v1);
      const dist = this.distance(closestPoint, point);

      if (dist < edgeRadius) {
        // Edge snap - ABSOLUTE HIGHEST priority for smooth sliding along edges
        // Maximum confidence ensures edges ALWAYS win over vertices/faces
        targets.push({
          type: SnapType.EDGE,
          position: closestPoint,
          expressId: mesh.expressId,
          confidence: 0.999 * (1.0 - dist / edgeRadius), // Nearly perfect priority for edges
          metadata: { vertices: [edge.v0, edge.v1], edgeIndex: edge.index },
        });

        // Edge midpoint snap - only when very close to midpoint
        const midpoint: Vec3 = {
          x: (edge.v0.x + edge.v1.x) / 2,
          y: (edge.v0.y + edge.v1.y) / 2,
          z: (edge.v0.z + edge.v1.z) / 2,
        };
        const midDist = this.distance(midpoint, point);

        // Only snap to midpoint when within 1/3 of snap radius
        if (midDist < radius * 0.33) {
          targets.push({
            type: SnapType.EDGE_MIDPOINT,
            position: midpoint,
            expressId: mesh.expressId,
            confidence: 1.0 * (1.0 - midDist / (radius * 0.33)), // Very high when close
            metadata: { vertices: [edge.v0, edge.v1], edgeIndex: edge.index },
          });
        }
      }
    }

    return targets;
  }

  /**
   * Clear geometry cache (call when meshes change)
   */
  clearCache(): void {
    this.geometryCache.clear();
  }

  /**
   * Find faces/planes near intersection
   */
  private findFaces(mesh: MeshData, intersection: Intersection, radius: number): SnapTarget[] {
    const targets: SnapTarget[] = [];

    // Add the intersected face
    targets.push({
      type: SnapType.FACE,
      position: intersection.point,
      normal: intersection.normal,
      expressId: mesh.expressId,
      confidence: 0.5, // Lower priority than vertices/edges
      metadata: { faceIndex: intersection.triangleIndex },
    });

    // Calculate face center (centroid of triangle)
    const positions = mesh.positions;
    const indices = mesh.indices;

    if (indices) {
      const triIndex = intersection.triangleIndex * 3;
      const i0 = indices[triIndex] * 3;
      const i1 = indices[triIndex + 1] * 3;
      const i2 = indices[triIndex + 2] * 3;

      const v0: Vec3 = {
        x: positions[i0],
        y: positions[i0 + 1],
        z: positions[i0 + 2],
      };
      const v1: Vec3 = {
        x: positions[i1],
        y: positions[i1 + 1],
        z: positions[i1 + 2],
      };
      const v2: Vec3 = {
        x: positions[i2],
        y: positions[i2 + 1],
        z: positions[i2 + 2],
      };

      const center: Vec3 = {
        x: (v0.x + v1.x + v2.x) / 3,
        y: (v0.y + v1.y + v2.y) / 3,
        z: (v0.z + v1.z + v2.z) / 3,
      };

      const dist = this.distance(center, intersection.point);
      if (dist < radius) {
        targets.push({
          type: SnapType.FACE_CENTER,
          position: center,
          normal: intersection.normal,
          expressId: mesh.expressId,
          confidence: 0.7 * (1.0 - dist / radius),
          metadata: { faceIndex: intersection.triangleIndex },
        });
      }
    }

    return targets;
  }

  /**
   * Select best snap target based on confidence and priority
   */
  private getBestSnapTarget(targets: SnapTarget[], cursorPoint: Vec3): SnapTarget | null {
    if (targets.length === 0) return null;

    // Priority order: vertex > edge_midpoint > edge > face_center > face
    const priorityMap = {
      [SnapType.VERTEX]: 5,
      [SnapType.EDGE_MIDPOINT]: 4,
      [SnapType.EDGE]: 3,
      [SnapType.FACE_CENTER]: 2,
      [SnapType.FACE]: 1,
    };

    // Sort by priority then confidence
    targets.sort((a, b) => {
      const priorityDiff = priorityMap[b.type] - priorityMap[a.type];
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });

    return targets[0];
  }

  /**
   * Convert screen-space radius to world-space radius
   */
  private screenToWorldRadius(
    screenRadius: number,
    distance: number,
    fov: number,
    screenHeight: number
  ): number {
    // Calculate world height at distance
    const fovRadians = (fov * Math.PI) / 180;
    const worldHeight = 2 * distance * Math.tan(fovRadians / 2);

    // Convert screen pixels to world units
    return (screenRadius / screenHeight) * worldHeight;
  }

  /**
   * Vector utilities
   */
  private distance(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
}
