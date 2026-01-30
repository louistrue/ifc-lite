/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Parameter Applicator for Geometry Editing
 *
 * Applies parameter changes to IFC entities and re-triangulates geometry.
 * Provides live preview with immediate visual feedback.
 */

import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import {
  type GeometryParameter,
  type GeometryMutation,
  type MutationResult,
  type ConstraintViolation,
  type Point2D,
  type Profile2D,
  type ExtrusionDef,
  type ParameterValue,
  GeometryMutationType,
  ParameterType,
  ConstraintType,
  ProfileType,
  generateMutationId,
  cloneVec3,
  normalizeVec3,
  crossVec3,
} from './types.js';

/**
 * Configuration for parameter application
 */
export interface ApplicatorConfig {
  /** Whether to validate constraints before applying */
  validateConstraints: boolean;
  /** Whether to generate preview mesh */
  generatePreview: boolean;
  /** Tolerance for geometry generation */
  tolerance: number;
  /** Number of segments for curved profiles */
  curveSegments: number;
}

const DEFAULT_CONFIG: ApplicatorConfig = {
  validateConstraints: true,
  generatePreview: true,
  tolerance: 0.001,
  curveSegments: 32,
};

/**
 * Applies parameter changes and generates updated geometry
 */
export class ParameterApplicator {
  private config: ApplicatorConfig;

  constructor(config: Partial<ApplicatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Apply a parameter change and generate new mesh
   */
  applyParameterChange(
    parameter: GeometryParameter,
    newValue: ParameterValue,
    currentMesh: MeshData
  ): MutationResult {
    // Validate constraints if enabled
    if (this.config.validateConstraints) {
      const violations = this.validateConstraints(parameter, newValue);
      if (violations.length > 0) {
        return {
          success: false,
          error: violations[0].message,
          constraintViolations: violations,
        };
      }
    }

    // Create mutation record
    const mutation: GeometryMutation = {
      id: generateMutationId(),
      type: GeometryMutationType.ParameterChange,
      timestamp: Date.now(),
      modelId: parameter.modelId,
      entityId: parameter.entityId,
      globalId: parameter.entityId, // Will be updated by caller
      parameterPath: parameter.path,
      oldValue: parameter.value,
      newValue,
    };

    // Generate new mesh based on parameter type and path
    const meshData = this.regenerateMesh(parameter, newValue, currentMesh);

    if (!meshData) {
      return {
        success: false,
        error: 'Failed to regenerate mesh',
      };
    }

    // Update parameter value
    const updatedParameter: GeometryParameter = {
      ...parameter,
      value: newValue,
    };

    return {
      success: true,
      meshData,
      updatedParameters: [updatedParameter],
    };
  }

  /**
   * Validate constraints for a parameter value
   */
  validateConstraints(
    parameter: GeometryParameter,
    value: ParameterValue
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];

    for (const constraint of parameter.constraints) {
      if (!constraint.enabled) continue;

      const violation = this.checkConstraint(constraint, parameter, value);
      if (violation) {
        violations.push(violation);
      }
    }

    return violations;
  }

  /**
   * Check a single constraint
   */
  private checkConstraint(
    constraint: import('./types.js').Constraint,
    parameter: GeometryParameter,
    value: ParameterValue
  ): ConstraintViolation | null {
    switch (constraint.type) {
      case ConstraintType.Positive:
        if (typeof value === 'number' && value <= 0) {
          return {
            constraint,
            parameterPath: parameter.path,
            currentValue: value,
            suggestedValue: 0.001,
            message: `${parameter.displayName} must be positive`,
          };
        }
        break;

      case ConstraintType.MinValue:
        if (
          typeof value === 'number' &&
          constraint.value !== undefined &&
          value < constraint.value
        ) {
          return {
            constraint,
            parameterPath: parameter.path,
            currentValue: value,
            suggestedValue: constraint.value,
            message: `${parameter.displayName} must be at least ${constraint.value}`,
          };
        }
        break;

      case ConstraintType.MaxValue:
        if (
          typeof value === 'number' &&
          constraint.value !== undefined &&
          value > constraint.value
        ) {
          return {
            constraint,
            parameterPath: parameter.path,
            currentValue: value,
            suggestedValue: constraint.value,
            message: `${parameter.displayName} must be at most ${constraint.value}`,
          };
        }
        break;

      case ConstraintType.ClosedProfile:
        if (Array.isArray(value)) {
          const points = value as Point2D[];
          if (points.length < 3) {
            return {
              constraint,
              parameterPath: parameter.path,
              currentValue: value,
              message: 'Profile must have at least 3 points',
            };
          }
        }
        break;
    }

    return null;
  }

  /**
   * Regenerate mesh based on parameter change
   */
  private regenerateMesh(
    parameter: GeometryParameter,
    newValue: ParameterValue,
    currentMesh: MeshData
  ): MeshData | null {
    const path = parameter.path;
    console.log('[ParameterApplicator] regenerateMesh:', {
      path,
      oldValue: parameter.value,
      newValue,
      currentMeshVertices: currentMesh.positions?.length ? currentMesh.positions.length / 3 : 0,
    });

    let result: MeshData | null = null;

    // Handle extrusion depth change
    if (path === 'Depth' || path.endsWith('.Depth')) {
      console.log('[ParameterApplicator] Applying depth change');
      result = this.applyDepthChange(
        currentMesh,
        parameter.value as number,
        newValue as number
      );
    }
    // Handle profile dimension changes (XDim, YDim, Radius, etc.)
    else if (
      path.includes('XDim') ||
      path.includes('YDim') ||
      path.includes('Radius') ||
      path.includes('SemiAxis')
    ) {
      console.log('[ParameterApplicator] Applying profile dimension change');
      result = this.applyProfileDimensionChange(
        currentMesh,
        path,
        parameter.value as number,
        newValue as number
      );
    }
    // Handle direction changes
    else if (path.includes('Direction')) {
      console.log('[ParameterApplicator] Applying direction change');
      result = this.applyDirectionChange(
        currentMesh,
        parameter.value as Vec3,
        newValue as Vec3
      );
    }
    // Handle arbitrary profile point changes
    else if (path.includes('OuterCurve')) {
      console.log('[ParameterApplicator] OuterCurve change - WASM path needed');
      // Full re-triangulation needed - return null to trigger WASM path
      return null;
    }
    // Default: return current mesh (no change possible without WASM)
    else {
      console.log('[ParameterApplicator] Unknown parameter path, returning current mesh');
      result = currentMesh;
    }

    if (result) {
      console.log('[ParameterApplicator] Result mesh vertices:', result.positions?.length ? result.positions.length / 3 : 0);
    }
    return result;
  }

  /**
   * Apply extrusion depth change by scaling Z coordinates
   */
  private applyDepthChange(
    mesh: MeshData,
    oldDepth: number,
    newDepth: number
  ): MeshData {
    if (oldDepth <= 0 || newDepth <= 0) return mesh;

    const scale = newDepth / oldDepth;
    const positions = new Float32Array(mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length);

    // Find extrusion direction by analyzing mesh normals
    // Typically Z-axis for most extrusions
    const extrusionAxis = this.detectExtrusionAxis(mesh);

    // Calculate bounds to find the base plane
    let minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const coord = this.getAxisCoord(mesh.positions, i, extrusionAxis);
      if (coord < minZ) minZ = coord;
      if (coord > maxZ) maxZ = coord;
    }

    const baseZ = minZ;

    // Scale positions along extrusion axis
    for (let i = 0; i < mesh.positions.length; i += 3) {
      positions[i] = mesh.positions[i];
      positions[i + 1] = mesh.positions[i + 1];
      positions[i + 2] = mesh.positions[i + 2];

      const coord = this.getAxisCoord(mesh.positions, i, extrusionAxis);
      const relativeZ = coord - baseZ;
      const newCoord = baseZ + relativeZ * scale;
      this.setAxisCoord(positions, i, extrusionAxis, newCoord);
    }

    // Copy normals (they remain valid for uniform scaling along extrusion axis)
    normals.set(mesh.normals);

    return {
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      modelIndex: mesh.modelIndex,
      positions,
      normals,
      indices: new Uint32Array(mesh.indices),
      color: [...mesh.color] as [number, number, number, number],
    };
  }

  /**
   * Apply profile dimension change (width, height, radius)
   */
  private applyProfileDimensionChange(
    mesh: MeshData,
    paramPath: string,
    oldValue: number,
    newValue: number
  ): MeshData {
    if (oldValue <= 0 || newValue <= 0) return mesh;

    const scale = newValue / oldValue;
    const positions = new Float32Array(mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length);

    // Determine which axis to scale based on parameter
    const isXDim =
      paramPath.includes('XDim') || paramPath.includes('OverallWidth');
    const isYDim =
      paramPath.includes('YDim') || paramPath.includes('OverallDepth');
    const isRadius =
      paramPath.includes('Radius') || paramPath.includes('SemiAxis');

    // Calculate centroid for scaling
    let cx = 0,
      cy = 0,
      cz = 0;
    const vertexCount = mesh.positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      cx += mesh.positions[i];
      cy += mesh.positions[i + 1];
      cz += mesh.positions[i + 2];
    }
    cx /= vertexCount;
    cy /= vertexCount;
    cz /= vertexCount;

    // Scale positions relative to centroid
    for (let i = 0; i < mesh.positions.length; i += 3) {
      let x = mesh.positions[i];
      let y = mesh.positions[i + 1];
      let z = mesh.positions[i + 2];

      if (isRadius) {
        // Radial scaling (X and Y)
        x = cx + (x - cx) * scale;
        y = cy + (y - cy) * scale;
      } else if (isXDim) {
        // Scale X only
        x = cx + (x - cx) * scale;
      } else if (isYDim) {
        // Scale Y only
        y = cy + (y - cy) * scale;
      }

      positions[i] = x;
      positions[i + 1] = y;
      positions[i + 2] = z;
    }

    // Recalculate normals for non-uniform scaling
    this.recalculateNormals(positions, mesh.indices, normals);

    return {
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      modelIndex: mesh.modelIndex,
      positions,
      normals,
      indices: new Uint32Array(mesh.indices),
      color: [...mesh.color] as [number, number, number, number],
    };
  }

  /**
   * Apply extrusion direction change
   */
  private applyDirectionChange(
    mesh: MeshData,
    oldDirection: Vec3,
    newDirection: Vec3
  ): MeshData {
    // Normalize directions
    const oldDir = normalizeVec3(oldDirection);
    const newDir = normalizeVec3(newDirection);

    // Calculate rotation axis and angle
    const rotationAxis = crossVec3(oldDir, newDir);
    const axisLength = Math.sqrt(
      rotationAxis.x * rotationAxis.x +
        rotationAxis.y * rotationAxis.y +
        rotationAxis.z * rotationAxis.z
    );

    if (axisLength < 1e-6) {
      // Directions are parallel or anti-parallel
      return mesh;
    }

    // Normalize rotation axis
    rotationAxis.x /= axisLength;
    rotationAxis.y /= axisLength;
    rotationAxis.z /= axisLength;

    // Calculate rotation angle
    const dot =
      oldDir.x * newDir.x + oldDir.y * newDir.y + oldDir.z * newDir.z;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (Math.abs(angle) < 1e-6) {
      return mesh;
    }

    // Create rotation matrix (Rodrigues' formula)
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const t = 1 - c;
    const x = rotationAxis.x;
    const y = rotationAxis.y;
    const z = rotationAxis.z;

    // Calculate centroid for rotation pivot
    let cx = 0,
      cy = 0,
      cz = 0;
    const vertexCount = mesh.positions.length / 3;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      cx += mesh.positions[i];
      cy += mesh.positions[i + 1];
      cz += mesh.positions[i + 2];
    }
    cx /= vertexCount;
    cy /= vertexCount;
    cz /= vertexCount;

    const positions = new Float32Array(mesh.positions.length);
    const normals = new Float32Array(mesh.normals.length);

    // Apply rotation to each vertex
    for (let i = 0; i < mesh.positions.length; i += 3) {
      // Translate to origin
      const px = mesh.positions[i] - cx;
      const py = mesh.positions[i + 1] - cy;
      const pz = mesh.positions[i + 2] - cz;

      // Rotate
      positions[i] =
        (t * x * x + c) * px +
        (t * x * y - s * z) * py +
        (t * x * z + s * y) * pz +
        cx;
      positions[i + 1] =
        (t * x * y + s * z) * px +
        (t * y * y + c) * py +
        (t * y * z - s * x) * pz +
        cy;
      positions[i + 2] =
        (t * x * z - s * y) * px +
        (t * y * z + s * x) * py +
        (t * z * z + c) * pz +
        cz;

      // Rotate normals (no translation needed)
      const nx = mesh.normals[i];
      const ny = mesh.normals[i + 1];
      const nz = mesh.normals[i + 2];

      normals[i] =
        (t * x * x + c) * nx +
        (t * x * y - s * z) * ny +
        (t * x * z + s * y) * nz;
      normals[i + 1] =
        (t * x * y + s * z) * nx +
        (t * y * y + c) * ny +
        (t * y * z - s * x) * nz;
      normals[i + 2] =
        (t * x * z - s * y) * nx +
        (t * y * z + s * x) * ny +
        (t * z * z + c) * nz;
    }

    return {
      expressId: mesh.expressId,
      ifcType: mesh.ifcType,
      modelIndex: mesh.modelIndex,
      positions,
      normals,
      indices: new Uint32Array(mesh.indices),
      color: [...mesh.color] as [number, number, number, number],
    };
  }

  /**
   * Detect primary extrusion axis from mesh
   */
  private detectExtrusionAxis(mesh: MeshData): 'x' | 'y' | 'z' {
    // Analyze bounding box to find smallest dimension
    // Extrusion is typically along the largest dimension
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < mesh.positions.length; i += 3) {
      const x = mesh.positions[i];
      const y = mesh.positions[i + 1];
      const z = mesh.positions[i + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;

    // Return axis with largest extent (most likely extrusion direction)
    if (extentZ >= extentX && extentZ >= extentY) return 'z';
    if (extentY >= extentX && extentY >= extentZ) return 'y';
    return 'x';
  }

  /**
   * Get coordinate along specified axis
   */
  private getAxisCoord(
    positions: Float32Array,
    index: number,
    axis: 'x' | 'y' | 'z'
  ): number {
    switch (axis) {
      case 'x':
        return positions[index];
      case 'y':
        return positions[index + 1];
      case 'z':
        return positions[index + 2];
    }
  }

  /**
   * Set coordinate along specified axis
   */
  private setAxisCoord(
    positions: Float32Array,
    index: number,
    axis: 'x' | 'y' | 'z',
    value: number
  ): void {
    switch (axis) {
      case 'x':
        positions[index] = value;
        break;
      case 'y':
        positions[index + 1] = value;
        break;
      case 'z':
        positions[index + 2] = value;
        break;
    }
  }

  /**
   * Recalculate normals for a mesh
   */
  private recalculateNormals(
    positions: Float32Array,
    indices: Uint32Array,
    normals: Float32Array
  ): void {
    // Initialize normals to zero
    normals.fill(0);

    // Accumulate face normals for each vertex
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i];
      const i1 = indices[i + 1];
      const i2 = indices[i + 2];

      // Get vertex positions
      const v0x = positions[i0 * 3];
      const v0y = positions[i0 * 3 + 1];
      const v0z = positions[i0 * 3 + 2];
      const v1x = positions[i1 * 3];
      const v1y = positions[i1 * 3 + 1];
      const v1z = positions[i1 * 3 + 2];
      const v2x = positions[i2 * 3];
      const v2y = positions[i2 * 3 + 1];
      const v2z = positions[i2 * 3 + 2];

      // Calculate edge vectors
      const e1x = v1x - v0x;
      const e1y = v1y - v0y;
      const e1z = v1z - v0z;
      const e2x = v2x - v0x;
      const e2y = v2y - v0y;
      const e2z = v2z - v0z;

      // Cross product = face normal (not normalized, weighted by area)
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      // Accumulate to each vertex
      normals[i0 * 3] += nx;
      normals[i0 * 3 + 1] += ny;
      normals[i0 * 3 + 2] += nz;
      normals[i1 * 3] += nx;
      normals[i1 * 3 + 1] += ny;
      normals[i1 * 3 + 2] += nz;
      normals[i2 * 3] += nx;
      normals[i2 * 3 + 1] += ny;
      normals[i2 * 3 + 2] += nz;
    }

    // Normalize all normals
    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i];
      const ny = normals[i + 1];
      const nz = normals[i + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      if (len > 1e-10) {
        normals[i] = nx / len;
        normals[i + 1] = ny / len;
        normals[i + 2] = nz / len;
      } else {
        // Default normal for degenerate triangles
        normals[i] = 0;
        normals[i + 1] = 0;
        normals[i + 2] = 1;
      }
    }
  }

  /**
   * Generate mesh from extrusion definition
   * This creates geometry directly without WASM (for simple cases)
   */
  generateExtrusionMesh(
    extrusion: ExtrusionDef,
    expressId: number,
    color: [number, number, number, number]
  ): MeshData | null {
    const { profile, depth, direction = { x: 0, y: 0, z: 1 } } = extrusion;

    // Get profile points
    let points: Point2D[];

    switch (profile.type) {
      case ProfileType.Rectangle:
        points = this.rectangleToPoints(
          profile.width || 1,
          profile.height || 1
        );
        break;
      case ProfileType.Circle:
        points = this.circleToPoints(profile.radius || 0.5);
        break;
      case ProfileType.Ellipse:
        points = this.ellipseToPoints(
          profile.semiAxis1 || 0.5,
          profile.semiAxis2 || 0.25
        );
        break;
      case ProfileType.Arbitrary:
        points = profile.points || [];
        break;
      default:
        return null;
    }

    if (points.length < 3) return null;

    // Generate extrusion mesh
    return this.extrudeProfile(points, depth, direction, expressId, color);
  }

  /**
   * Convert rectangle to points
   */
  private rectangleToPoints(width: number, height: number): Point2D[] {
    const hw = width / 2;
    const hh = height / 2;
    return [
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ];
  }

  /**
   * Convert circle to points
   */
  private circleToPoints(radius: number): Point2D[] {
    const points: Point2D[] = [];
    const segments = this.config.curveSegments;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }

    return points;
  }

  /**
   * Convert ellipse to points
   */
  private ellipseToPoints(semiAxis1: number, semiAxis2: number): Point2D[] {
    const points: Point2D[] = [];
    const segments = this.config.curveSegments;

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push({
        x: Math.cos(angle) * semiAxis1,
        y: Math.sin(angle) * semiAxis2,
      });
    }

    return points;
  }

  /**
   * Extrude a 2D profile into a 3D mesh
   */
  private extrudeProfile(
    points: Point2D[],
    depth: number,
    direction: Vec3,
    expressId: number,
    color: [number, number, number, number]
  ): MeshData {
    const n = points.length;
    const dir = normalizeVec3(direction);

    // Calculate vertex count: bottom cap + top cap + sides
    // Bottom/Top cap: n vertices each
    // Sides: (n * 2) vertices per quad strip
    const vertexCount = n * 2 + n * 4;
    const triangleCount = n - 2 + (n - 2) + n * 2;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const indices = new Uint32Array(triangleCount * 3);

    let vIndex = 0;
    let iIndex = 0;

    // Calculate normal for bottom cap (opposite of extrusion direction)
    const bottomNormal = { x: -dir.x, y: -dir.y, z: -dir.z };
    const topNormal = { x: dir.x, y: dir.y, z: dir.z };

    // Add bottom cap vertices
    const bottomStart = vIndex / 3;
    for (let i = 0; i < n; i++) {
      positions[vIndex++] = points[i].x;
      positions[vIndex++] = points[i].y;
      positions[vIndex++] = 0;
      normals[vIndex - 3] = bottomNormal.x;
      normals[vIndex - 2] = bottomNormal.y;
      normals[vIndex - 1] = bottomNormal.z;
    }

    // Triangulate bottom cap (fan triangulation)
    for (let i = 1; i < n - 1; i++) {
      indices[iIndex++] = bottomStart;
      indices[iIndex++] = bottomStart + i + 1; // Reverse winding for bottom
      indices[iIndex++] = bottomStart + i;
    }

    // Add top cap vertices
    const topStart = vIndex / 3;
    for (let i = 0; i < n; i++) {
      positions[vIndex++] = points[i].x + dir.x * depth;
      positions[vIndex++] = points[i].y + dir.y * depth;
      positions[vIndex++] = dir.z * depth;
      normals[vIndex - 3] = topNormal.x;
      normals[vIndex - 2] = topNormal.y;
      normals[vIndex - 1] = topNormal.z;
    }

    // Triangulate top cap
    for (let i = 1; i < n - 1; i++) {
      indices[iIndex++] = topStart;
      indices[iIndex++] = topStart + i;
      indices[iIndex++] = topStart + i + 1;
    }

    // Add side faces
    const sideStart = vIndex / 3;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;

      // Calculate side normal (perpendicular to edge and extrusion direction)
      const edgeX = points[next].x - points[i].x;
      const edgeY = points[next].y - points[i].y;
      // For Z-up extrusion, side normal is (-edgeY, edgeX, 0) normalized
      const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
      const sideNormal =
        len > 0
          ? { x: -edgeY / len, y: edgeX / len, z: 0 }
          : { x: 1, y: 0, z: 0 };

      // Bottom-left
      positions[vIndex++] = points[i].x;
      positions[vIndex++] = points[i].y;
      positions[vIndex++] = 0;
      normals[vIndex - 3] = sideNormal.x;
      normals[vIndex - 2] = sideNormal.y;
      normals[vIndex - 1] = sideNormal.z;

      // Bottom-right
      positions[vIndex++] = points[next].x;
      positions[vIndex++] = points[next].y;
      positions[vIndex++] = 0;
      normals[vIndex - 3] = sideNormal.x;
      normals[vIndex - 2] = sideNormal.y;
      normals[vIndex - 1] = sideNormal.z;

      // Top-right
      positions[vIndex++] = points[next].x + dir.x * depth;
      positions[vIndex++] = points[next].y + dir.y * depth;
      positions[vIndex++] = dir.z * depth;
      normals[vIndex - 3] = sideNormal.x;
      normals[vIndex - 2] = sideNormal.y;
      normals[vIndex - 1] = sideNormal.z;

      // Top-left
      positions[vIndex++] = points[i].x + dir.x * depth;
      positions[vIndex++] = points[i].y + dir.y * depth;
      positions[vIndex++] = dir.z * depth;
      normals[vIndex - 3] = sideNormal.x;
      normals[vIndex - 2] = sideNormal.y;
      normals[vIndex - 1] = sideNormal.z;

      // Two triangles per quad
      const base = sideStart + i * 4;
      indices[iIndex++] = base;
      indices[iIndex++] = base + 1;
      indices[iIndex++] = base + 2;
      indices[iIndex++] = base;
      indices[iIndex++] = base + 2;
      indices[iIndex++] = base + 3;
    }

    return {
      expressId,
      positions: positions.slice(0, vIndex),
      normals: normals.slice(0, vIndex),
      indices: indices.slice(0, iIndex),
      color,
    };
  }
}

/**
 * Create a parameter applicator
 */
export function createParameterApplicator(
  config?: Partial<ApplicatorConfig>
): ParameterApplicator {
  return new ParameterApplicator(config);
}
