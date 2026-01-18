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

interface MeshGeometryCache {
  vertices: Vec3[];
  edges: Array<{ v0: Vec3; v1: Vec3; index: number }>;
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
      const emptyCache: MeshGeometryCache = { vertices: [], edges: [] };
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

    // Compute and cache edges
    const edges: Array<{ v0: Vec3; v1: Vec3; index: number }> = [];
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
            edgeMap.set(key, { v0, v1, index: edgeMap.size });
          }
        }
      }

      edges.push(...edgeMap.values());
    }

    const cache: MeshGeometryCache = { vertices, edges };
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
