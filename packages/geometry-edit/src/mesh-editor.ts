/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Mesh Editor for Direct Geometry Manipulation
 *
 * Supports vertex, edge, and face operations for non-parametric geometry.
 * Provides live preview during manipulation.
 */

import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import {
  type MeshSelection,
  type MeshEditOperation,
  MeshSelectionType,
  addVec3,
  scaleVec3,
  subtractVec3,
  normalizeVec3,
  crossVec3,
  dotVec3,
  lengthVec3,
} from './types.js';

/**
 * Result of a mesh edit operation
 */
export interface MeshEditResult {
  success: boolean;
  error?: string;
  meshData?: MeshData;
  affectedVertices?: number[];
}

/**
 * Options for mesh editing
 */
export interface MeshEditorOptions {
  /** Preserve smooth shading by averaging normals */
  preserveSmoothing: boolean;
  /** Snap to grid (in world units, 0 to disable) */
  gridSnap: number;
  /** Minimum edge length to prevent degenerate geometry */
  minEdgeLength: number;
}

const DEFAULT_OPTIONS: MeshEditorOptions = {
  preserveSmoothing: true,
  gridSnap: 0,
  minEdgeLength: 0.001,
};

/**
 * Direct mesh editing operations
 */
export class MeshEditor {
  private options: MeshEditorOptions;

  constructor(options: Partial<MeshEditorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Apply an edit operation to a mesh
   */
  applyOperation(mesh: MeshData, operation: MeshEditOperation): MeshEditResult {
    switch (operation.type) {
      case 'move':
        return this.moveSelection(
          mesh,
          operation.selection,
          operation.value as Vec3,
          operation.constrainToNormal,
          operation.constrainToAxis
        );

      case 'scale':
        return this.scaleSelection(
          mesh,
          operation.selection,
          operation.value as number
        );

      case 'extrude':
        return this.extrudeFace(
          mesh,
          operation.selection,
          operation.value as Vec3
        );

      default:
        return { success: false, error: 'Unknown operation type' };
    }
  }

  /**
   * Move selected vertices/edges/faces
   */
  moveSelection(
    mesh: MeshData,
    selection: MeshSelection,
    delta: Vec3,
    constrainToNormal?: boolean,
    constrainToAxis?: 'x' | 'y' | 'z'
  ): MeshEditResult {
    // Get affected vertex indices
    const vertexIndices = this.getAffectedVertices(mesh, selection);
    if (vertexIndices.length === 0) {
      return { success: false, error: 'No vertices selected' };
    }

    // Apply constraints to delta
    let constrainedDelta = { ...delta };

    if (constrainToNormal && selection.normal) {
      // Project delta onto normal
      const dot = dotVec3(delta, selection.normal);
      constrainedDelta = scaleVec3(selection.normal, dot);
    } else if (constrainToAxis) {
      // Zero out other axes
      constrainedDelta = {
        x: constrainToAxis === 'x' ? delta.x : 0,
        y: constrainToAxis === 'y' ? delta.y : 0,
        z: constrainToAxis === 'z' ? delta.z : 0,
      };
    }

    // Apply grid snap
    if (this.options.gridSnap > 0) {
      constrainedDelta = this.snapToGrid(constrainedDelta);
    }

    // Clone mesh data
    const newPositions = new Float32Array(mesh.positions);
    const newNormals = new Float32Array(mesh.normals);

    // Apply delta to selected vertices
    for (const vi of vertexIndices) {
      newPositions[vi * 3] += constrainedDelta.x;
      newPositions[vi * 3 + 1] += constrainedDelta.y;
      newPositions[vi * 3 + 2] += constrainedDelta.z;
    }

    // Recalculate normals for affected triangles
    this.recalculateAffectedNormals(
      newPositions,
      mesh.indices,
      newNormals,
      vertexIndices
    );

    return {
      success: true,
      meshData: {
        expressId: mesh.expressId,
        ifcType: mesh.ifcType,
        modelIndex: mesh.modelIndex,
        positions: newPositions,
        normals: newNormals,
        indices: new Uint32Array(mesh.indices),
        color: [...mesh.color] as [number, number, number, number],
      },
      affectedVertices: vertexIndices,
    };
  }

  /**
   * Scale selection around its center
   */
  scaleSelection(
    mesh: MeshData,
    selection: MeshSelection,
    scaleFactor: number
  ): MeshEditResult {
    const vertexIndices = this.getAffectedVertices(mesh, selection);
    if (vertexIndices.length === 0) {
      return { success: false, error: 'No vertices selected' };
    }

    // Calculate center of selection
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const vi of vertexIndices) {
      cx += mesh.positions[vi * 3];
      cy += mesh.positions[vi * 3 + 1];
      cz += mesh.positions[vi * 3 + 2];
    }
    cx /= vertexIndices.length;
    cy /= vertexIndices.length;
    cz /= vertexIndices.length;

    // Clone and scale
    const newPositions = new Float32Array(mesh.positions);
    const newNormals = new Float32Array(mesh.normals);

    for (const vi of vertexIndices) {
      const x = mesh.positions[vi * 3];
      const y = mesh.positions[vi * 3 + 1];
      const z = mesh.positions[vi * 3 + 2];

      newPositions[vi * 3] = cx + (x - cx) * scaleFactor;
      newPositions[vi * 3 + 1] = cy + (y - cy) * scaleFactor;
      newPositions[vi * 3 + 2] = cz + (z - cz) * scaleFactor;
    }

    // Recalculate normals
    this.recalculateAffectedNormals(
      newPositions,
      mesh.indices,
      newNormals,
      vertexIndices
    );

    return {
      success: true,
      meshData: {
        expressId: mesh.expressId,
        ifcType: mesh.ifcType,
        modelIndex: mesh.modelIndex,
        positions: newPositions,
        normals: newNormals,
        indices: new Uint32Array(mesh.indices),
        color: [...mesh.color] as [number, number, number, number],
      },
      affectedVertices: vertexIndices,
    };
  }

  /**
   * Extrude a face along its normal
   */
  extrudeFace(
    mesh: MeshData,
    selection: MeshSelection,
    delta: Vec3
  ): MeshEditResult {
    if (selection.type !== MeshSelectionType.Face || selection.faceIndex === undefined) {
      return { success: false, error: 'Face selection required for extrude' };
    }

    const faceIndex = selection.faceIndex;
    const indices = mesh.indices;

    // Get face vertices
    const i0 = indices[faceIndex * 3];
    const i1 = indices[faceIndex * 3 + 1];
    const i2 = indices[faceIndex * 3 + 2];

    // Get face vertex positions
    const v0: Vec3 = {
      x: mesh.positions[i0 * 3],
      y: mesh.positions[i0 * 3 + 1],
      z: mesh.positions[i0 * 3 + 2],
    };
    const v1: Vec3 = {
      x: mesh.positions[i1 * 3],
      y: mesh.positions[i1 * 3 + 1],
      z: mesh.positions[i1 * 3 + 2],
    };
    const v2: Vec3 = {
      x: mesh.positions[i2 * 3],
      y: mesh.positions[i2 * 3 + 1],
      z: mesh.positions[i2 * 3 + 2],
    };

    // Calculate face normal
    const edge1 = subtractVec3(v1, v0);
    const edge2 = subtractVec3(v2, v0);
    const faceNormal = normalizeVec3(crossVec3(edge1, edge2));

    // Project delta onto face normal if constraining
    let extrudeDelta = delta;
    if (selection.normal) {
      const dot = dotVec3(delta, faceNormal);
      extrudeDelta = scaleVec3(faceNormal, dot);
    }

    // Create new vertices for extruded face
    const nv0 = addVec3(v0, extrudeDelta);
    const nv1 = addVec3(v1, extrudeDelta);
    const nv2 = addVec3(v2, extrudeDelta);

    // Calculate new vertex count
    const oldVertexCount = mesh.positions.length / 3;
    const newVertexCount = oldVertexCount + 9; // 3 for new top face + 6 for side quads

    // Create new arrays
    const newPositions = new Float32Array(newVertexCount * 3);
    const newNormals = new Float32Array(newVertexCount * 3);

    // Copy existing positions and normals
    newPositions.set(mesh.positions);
    newNormals.set(mesh.normals);

    // Add new top face vertices
    let vi = oldVertexCount;

    // Top face vertices (with top normal)
    newPositions[vi * 3] = nv0.x;
    newPositions[vi * 3 + 1] = nv0.y;
    newPositions[vi * 3 + 2] = nv0.z;
    newNormals[vi * 3] = faceNormal.x;
    newNormals[vi * 3 + 1] = faceNormal.y;
    newNormals[vi * 3 + 2] = faceNormal.z;
    const topV0 = vi++;

    newPositions[vi * 3] = nv1.x;
    newPositions[vi * 3 + 1] = nv1.y;
    newPositions[vi * 3 + 2] = nv1.z;
    newNormals[vi * 3] = faceNormal.x;
    newNormals[vi * 3 + 1] = faceNormal.y;
    newNormals[vi * 3 + 2] = faceNormal.z;
    const topV1 = vi++;

    newPositions[vi * 3] = nv2.x;
    newPositions[vi * 3 + 1] = nv2.y;
    newPositions[vi * 3 + 2] = nv2.z;
    newNormals[vi * 3] = faceNormal.x;
    newNormals[vi * 3 + 1] = faceNormal.y;
    newNormals[vi * 3 + 2] = faceNormal.z;
    const topV2 = vi++;

    // Side face vertices (3 edges × 2 triangles × 3 vertices, but reusing)
    // For simplicity, add 6 more vertices for the 3 side quads
    // Each side quad needs 4 vertices, but we're creating triangles

    // Calculate new indices count: original + 1 top face + 3 side quads (6 triangles)
    const oldTriangleCount = mesh.indices.length / 3;
    const newTriangleCount = oldTriangleCount + 1 + 6; // +1 top, +6 for 3 quads
    const newIndices = new Uint32Array(newTriangleCount * 3);

    // Copy existing indices
    newIndices.set(mesh.indices);

    // Update original face to point downward (flip winding)
    newIndices[faceIndex * 3] = i0;
    newIndices[faceIndex * 3 + 1] = i2;
    newIndices[faceIndex * 3 + 2] = i1;

    // Update original face normals to point down
    const downNormal = scaleVec3(faceNormal, -1);
    newNormals[i0 * 3] = downNormal.x;
    newNormals[i0 * 3 + 1] = downNormal.y;
    newNormals[i0 * 3 + 2] = downNormal.z;
    newNormals[i1 * 3] = downNormal.x;
    newNormals[i1 * 3 + 1] = downNormal.y;
    newNormals[i1 * 3 + 2] = downNormal.z;
    newNormals[i2 * 3] = downNormal.x;
    newNormals[i2 * 3 + 1] = downNormal.y;
    newNormals[i2 * 3 + 2] = downNormal.z;

    let ii = mesh.indices.length;

    // Add top face
    newIndices[ii++] = topV0;
    newIndices[ii++] = topV1;
    newIndices[ii++] = topV2;

    // Add side faces (quads as pairs of triangles)
    // Side 0-1: v0->v1 and nv0->nv1
    const addSideQuad = (
      bv0: Vec3,
      bv1: Vec3,
      tv0: Vec3,
      tv1: Vec3,
      bi0: number,
      bi1: number,
      ti0: number,
      ti1: number
    ) => {
      // Calculate side normal
      const sideEdge = subtractVec3(bv1, bv0);
      const upEdge = subtractVec3(tv0, bv0);
      const sideNormal = normalizeVec3(crossVec3(sideEdge, upEdge));

      // We need to add 4 new vertices for each side (can't reuse due to normals)
      // Add bottom-left
      newPositions[vi * 3] = bv0.x;
      newPositions[vi * 3 + 1] = bv0.y;
      newPositions[vi * 3 + 2] = bv0.z;
      newNormals[vi * 3] = sideNormal.x;
      newNormals[vi * 3 + 1] = sideNormal.y;
      newNormals[vi * 3 + 2] = sideNormal.z;
      const sv0 = vi++;

      newPositions[vi * 3] = bv1.x;
      newPositions[vi * 3 + 1] = bv1.y;
      newPositions[vi * 3 + 2] = bv1.z;
      newNormals[vi * 3] = sideNormal.x;
      newNormals[vi * 3 + 1] = sideNormal.y;
      newNormals[vi * 3 + 2] = sideNormal.z;
      const sv1 = vi++;

      // Triangle 1
      newIndices[ii++] = sv0;
      newIndices[ii++] = sv1;
      newIndices[ii++] = ti1;

      // Triangle 2
      newIndices[ii++] = sv0;
      newIndices[ii++] = ti1;
      newIndices[ii++] = ti0;
    };

    // Add three side quads
    addSideQuad(v0, v1, nv0, nv1, i0, i1, topV0, topV1);
    addSideQuad(v1, v2, nv1, nv2, i1, i2, topV1, topV2);
    addSideQuad(v2, v0, nv2, nv0, i2, i0, topV2, topV0);

    return {
      success: true,
      meshData: {
        expressId: mesh.expressId,
        ifcType: mesh.ifcType,
        modelIndex: mesh.modelIndex,
        positions: newPositions.slice(0, vi * 3),
        normals: newNormals.slice(0, vi * 3),
        indices: newIndices.slice(0, ii),
        color: [...mesh.color] as [number, number, number, number],
      },
      affectedVertices: [topV0, topV1, topV2],
    };
  }

  /**
   * Get vertex indices affected by a selection
   */
  getAffectedVertices(mesh: MeshData, selection: MeshSelection): number[] {
    switch (selection.type) {
      case MeshSelectionType.Vertex:
        return selection.vertexIndices || [];

      case MeshSelectionType.Edge:
        if (selection.edge) {
          return [selection.edge[0], selection.edge[1]];
        }
        return [];

      case MeshSelectionType.Face:
        if (selection.faceIndex !== undefined) {
          const fi = selection.faceIndex * 3;
          return [
            mesh.indices[fi],
            mesh.indices[fi + 1],
            mesh.indices[fi + 2],
          ];
        }
        return [];

      default:
        return [];
    }
  }

  /**
   * Find vertex at a position (with tolerance)
   */
  findVertexAtPosition(
    mesh: MeshData,
    position: Vec3,
    tolerance: number = 0.01
  ): number | null {
    const toleranceSq = tolerance * tolerance;

    for (let i = 0; i < mesh.positions.length; i += 3) {
      const dx = mesh.positions[i] - position.x;
      const dy = mesh.positions[i + 1] - position.y;
      const dz = mesh.positions[i + 2] - position.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < toleranceSq) {
        return i / 3;
      }
    }

    return null;
  }

  /**
   * Find edge closest to a position
   */
  findEdgeAtPosition(
    mesh: MeshData,
    position: Vec3,
    tolerance: number = 0.01
  ): [number, number] | null {
    let closestEdge: [number, number] | null = null;
    let closestDist = tolerance;

    const indices = mesh.indices;

    for (let i = 0; i < indices.length; i += 3) {
      const edges: [number, number][] = [
        [indices[i], indices[i + 1]],
        [indices[i + 1], indices[i + 2]],
        [indices[i + 2], indices[i]],
      ];

      for (const edge of edges) {
        const v0: Vec3 = {
          x: mesh.positions[edge[0] * 3],
          y: mesh.positions[edge[0] * 3 + 1],
          z: mesh.positions[edge[0] * 3 + 2],
        };
        const v1: Vec3 = {
          x: mesh.positions[edge[1] * 3],
          y: mesh.positions[edge[1] * 3 + 1],
          z: mesh.positions[edge[1] * 3 + 2],
        };

        const dist = this.pointToEdgeDistance(position, v0, v1);
        if (dist < closestDist) {
          closestDist = dist;
          closestEdge = edge;
        }
      }
    }

    return closestEdge;
  }

  /**
   * Find face at a position (closest to point)
   */
  findFaceAtPosition(
    mesh: MeshData,
    position: Vec3,
    tolerance: number = 0.1
  ): number | null {
    let closestFace: number | null = null;
    let closestDist = tolerance;

    const indices = mesh.indices;
    const triangleCount = indices.length / 3;

    for (let fi = 0; fi < triangleCount; fi++) {
      const i0 = indices[fi * 3];
      const i1 = indices[fi * 3 + 1];
      const i2 = indices[fi * 3 + 2];

      // Get triangle center
      const cx =
        (mesh.positions[i0 * 3] +
          mesh.positions[i1 * 3] +
          mesh.positions[i2 * 3]) /
        3;
      const cy =
        (mesh.positions[i0 * 3 + 1] +
          mesh.positions[i1 * 3 + 1] +
          mesh.positions[i2 * 3 + 1]) /
        3;
      const cz =
        (mesh.positions[i0 * 3 + 2] +
          mesh.positions[i1 * 3 + 2] +
          mesh.positions[i2 * 3 + 2]) /
        3;

      const dx = cx - position.x;
      const dy = cy - position.y;
      const dz = cz - position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < closestDist) {
        closestDist = dist;
        closestFace = fi;
      }
    }

    return closestFace;
  }

  /**
   * Calculate distance from point to edge segment
   */
  private pointToEdgeDistance(point: Vec3, v0: Vec3, v1: Vec3): number {
    const edge = subtractVec3(v1, v0);
    const toPoint = subtractVec3(point, v0);

    const edgeLengthSq = dotVec3(edge, edge);
    if (edgeLengthSq < 1e-10) {
      return lengthVec3(toPoint);
    }

    // Project point onto edge line
    let t = dotVec3(toPoint, edge) / edgeLengthSq;
    t = Math.max(0, Math.min(1, t));

    // Closest point on edge
    const closest = addVec3(v0, scaleVec3(edge, t));
    return lengthVec3(subtractVec3(point, closest));
  }

  /**
   * Snap a vector to grid
   */
  private snapToGrid(v: Vec3): Vec3 {
    const grid = this.options.gridSnap;
    return {
      x: Math.round(v.x / grid) * grid,
      y: Math.round(v.y / grid) * grid,
      z: Math.round(v.z / grid) * grid,
    };
  }

  /**
   * Recalculate normals for triangles containing affected vertices
   */
  private recalculateAffectedNormals(
    positions: Float32Array,
    indices: Uint32Array,
    normals: Float32Array,
    affectedVertices: number[]
  ): void {
    const affectedSet = new Set(affectedVertices);

    // Find all triangles containing affected vertices
    const affectedTriangles: number[] = [];
    for (let i = 0; i < indices.length; i += 3) {
      if (
        affectedSet.has(indices[i]) ||
        affectedSet.has(indices[i + 1]) ||
        affectedSet.has(indices[i + 2])
      ) {
        affectedTriangles.push(i / 3);
      }
    }

    // Reset normals for affected vertices
    for (const vi of affectedVertices) {
      normals[vi * 3] = 0;
      normals[vi * 3 + 1] = 0;
      normals[vi * 3 + 2] = 0;
    }

    // Accumulate face normals
    for (const ti of affectedTriangles) {
      const i0 = indices[ti * 3];
      const i1 = indices[ti * 3 + 1];
      const i2 = indices[ti * 3 + 2];

      // Calculate face normal
      const v0x = positions[i0 * 3];
      const v0y = positions[i0 * 3 + 1];
      const v0z = positions[i0 * 3 + 2];
      const v1x = positions[i1 * 3];
      const v1y = positions[i1 * 3 + 1];
      const v1z = positions[i1 * 3 + 2];
      const v2x = positions[i2 * 3];
      const v2y = positions[i2 * 3 + 1];
      const v2z = positions[i2 * 3 + 2];

      const e1x = v1x - v0x;
      const e1y = v1y - v0y;
      const e1z = v1z - v0z;
      const e2x = v2x - v0x;
      const e2y = v2y - v0y;
      const e2z = v2z - v0z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      // Accumulate to affected vertices
      for (const vi of [i0, i1, i2]) {
        if (affectedSet.has(vi)) {
          normals[vi * 3] += nx;
          normals[vi * 3 + 1] += ny;
          normals[vi * 3 + 2] += nz;
        }
      }
    }

    // Normalize
    for (const vi of affectedVertices) {
      const nx = normals[vi * 3];
      const ny = normals[vi * 3 + 1];
      const nz = normals[vi * 3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      if (len > 1e-10) {
        normals[vi * 3] = nx / len;
        normals[vi * 3 + 1] = ny / len;
        normals[vi * 3 + 2] = nz / len;
      } else {
        normals[vi * 3] = 0;
        normals[vi * 3 + 1] = 0;
        normals[vi * 3 + 2] = 1;
      }
    }
  }
}

/**
 * Create a mesh editor
 */
export function createMeshEditor(
  options?: Partial<MeshEditorOptions>
): MeshEditor {
  return new MeshEditor(options);
}
