/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC4 Geometry Export
 *
 * Exports modified geometry as IfcTriangulatedFaceSet (IFC4).
 * Supports both mesh-edited and parameter-edited geometry.
 */

import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import type { GeometryMutation, GeometryParameter } from './types.js';
import { GeometryMutationType } from './types.js';

/**
 * IFC4 export options
 */
export interface Ifc4ExportOptions {
  /** Include coordinate list entity */
  includeCoordinates: boolean;
  /** Precision for coordinate values */
  precision: number;
  /** Generate normals entity */
  includeNormals: boolean;
  /** Start express ID for new entities */
  startExpressId: number;
}

const DEFAULT_OPTIONS: Ifc4ExportOptions = {
  includeCoordinates: true,
  precision: 6,
  includeNormals: true,
  startExpressId: 1000000,
};

/**
 * Exported IFC entity
 */
export interface ExportedEntity {
  expressId: number;
  type: string;
  line: string;
}

/**
 * Export result
 */
export interface Ifc4ExportResult {
  /** STEP entities generated */
  entities: ExportedEntity[];
  /** Main representation entity ID */
  representationId: number;
  /** Coordinate list entity ID */
  coordinateListId?: number;
  /** Indices list entity ID */
  indicesListId?: number;
  /** Statistics */
  stats: {
    vertexCount: number;
    triangleCount: number;
    entityCount: number;
  };
}

/**
 * IFC4 geometry exporter
 */
export class Ifc4GeometryExporter {
  private options: Ifc4ExportOptions;
  private nextExpressId: number;

  constructor(options: Partial<Ifc4ExportOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.nextExpressId = this.options.startExpressId;
  }

  /**
   * Export mesh as IfcTriangulatedFaceSet
   */
  exportMesh(mesh: MeshData): Ifc4ExportResult {
    const entities: ExportedEntity[] = [];
    const precision = this.options.precision;

    const vertexCount = mesh.positions.length / 3;
    const triangleCount = mesh.indices.length / 3;

    // Generate IfcCartesianPointList3D
    const coordinateListId = this.nextExpressId++;
    const coordinates = this.formatCoordinateList(mesh.positions, precision);
    entities.push({
      expressId: coordinateListId,
      type: 'IFCCARTESIANPOINTLIST3D',
      line: `#${coordinateListId}=IFCCARTESIANPOINTLIST3D((${coordinates}));`,
    });

    // Generate normals if requested
    let normalsId: number | undefined;
    if (this.options.includeNormals && mesh.normals.length > 0) {
      normalsId = this.nextExpressId++;
      const normals = this.formatNormalsList(mesh.normals, precision);
      entities.push({
        expressId: normalsId,
        type: 'IFCCARTESIANPOINTLIST3D',
        line: `#${normalsId}=IFCCARTESIANPOINTLIST3D((${normals}));`,
      });
    }

    // Generate IfcTriangulatedFaceSet
    const faceSetId = this.nextExpressId++;
    const indices = this.formatIndicesList(mesh.indices);

    // IfcTriangulatedFaceSet(Coordinates, Normals, Closed, CoordIndex, NormalIndex)
    const faceSetLine = normalsId
      ? `#${faceSetId}=IFCTRIANGULATEDFACESET(#${coordinateListId},#${normalsId},.U.,(${indices}),$);`
      : `#${faceSetId}=IFCTRIANGULATEDFACESET(#${coordinateListId},$,.U.,(${indices}),$);`;

    entities.push({
      expressId: faceSetId,
      type: 'IFCTRIANGULATEDFACESET',
      line: faceSetLine,
    });

    return {
      entities,
      representationId: faceSetId,
      coordinateListId,
      stats: {
        vertexCount,
        triangleCount,
        entityCount: entities.length,
      },
    };
  }

  /**
   * Export mesh with styled item (includes color)
   */
  exportMeshWithStyle(
    mesh: MeshData,
    color?: [number, number, number, number]
  ): Ifc4ExportResult {
    const baseResult = this.exportMesh(mesh);

    if (!color) {
      color = mesh.color;
    }

    // Generate color RGB
    const colorId = this.nextExpressId++;
    const [r, g, b, a] = color;
    baseResult.entities.push({
      expressId: colorId,
      type: 'IFCCOLOURRGB',
      line: `#${colorId}=IFCCOLOURRGB($,${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)});`,
    });

    // Generate surface style rendering
    const renderingId = this.nextExpressId++;
    const transparency = 1 - a;
    baseResult.entities.push({
      expressId: renderingId,
      type: 'IFCSURFACESTYLERENDERING',
      line: `#${renderingId}=IFCSURFACESTYLERENDERING(#${colorId},${transparency.toFixed(4)},$,$,$,$,$,$,.NOTDEFINED.);`,
    });

    // Generate surface style
    const surfaceStyleId = this.nextExpressId++;
    baseResult.entities.push({
      expressId: surfaceStyleId,
      type: 'IFCSURFACESTYLE',
      line: `#${surfaceStyleId}=IFCSURFACESTYLE($,.BOTH.,(#${renderingId}));`,
    });

    // Generate presentation style assignment
    const styleAssignmentId = this.nextExpressId++;
    baseResult.entities.push({
      expressId: styleAssignmentId,
      type: 'IFCPRESENTATIONSTYLEASSIGNMENT',
      line: `#${styleAssignmentId}=IFCPRESENTATIONSTYLEASSIGNMENT((#${surfaceStyleId}));`,
    });

    // Generate styled item
    const styledItemId = this.nextExpressId++;
    baseResult.entities.push({
      expressId: styledItemId,
      type: 'IFCSTYLEDITEM',
      line: `#${styledItemId}=IFCSTYLEDITEM(#${baseResult.representationId},(#${styleAssignmentId}),$);`,
    });

    baseResult.stats.entityCount = baseResult.entities.length;
    return baseResult;
  }

  /**
   * Export parameter changes as attribute updates
   */
  exportParameterChanges(
    mutations: GeometryMutation[],
    parameters: Map<string, GeometryParameter>
  ): string[] {
    const updates: string[] = [];

    for (const mutation of mutations) {
      if (mutation.type !== GeometryMutationType.ParameterChange) {
        continue;
      }

      if (
        mutation.parameterPath === undefined ||
        mutation.newValue === undefined
      ) {
        continue;
      }

      const param = parameters.get(
        `${mutation.modelId}:${mutation.entityId}:${mutation.parameterPath}`
      );

      if (!param) continue;

      // Generate update comment (actual IFC update would require full entity rewrite)
      const valueStr = this.formatParameterValue(mutation.newValue);
      updates.push(
        `/* UPDATE #${mutation.entityId} SET ${param.ifcAttributePath} = ${valueStr}; */`
      );
    }

    return updates;
  }

  /**
   * Generate replacement entities for edited geometry
   */
  generateReplacementEntities(
    originalEntityId: number,
    mesh: MeshData,
    globalId: string
  ): ExportedEntity[] {
    const result = this.exportMeshWithStyle(mesh);

    // Generate IfcShapeRepresentation
    const shapeRepId = this.nextExpressId++;
    result.entities.push({
      expressId: shapeRepId,
      type: 'IFCSHAPEREPRESENTATION',
      line: `#${shapeRepId}=IFCSHAPEREPRESENTATION($,'Body','Tessellation',(#${result.representationId}));`,
    });

    // Generate IfcProductDefinitionShape
    const productDefShapeId = this.nextExpressId++;
    result.entities.push({
      expressId: productDefShapeId,
      type: 'IFCPRODUCTDEFINITIONSHAPE',
      line: `#${productDefShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`,
    });

    return result.entities;
  }

  /**
   * Reset express ID counter
   */
  resetExpressId(startId?: number): void {
    this.nextExpressId = startId || this.options.startExpressId;
  }

  /**
   * Get current express ID
   */
  getCurrentExpressId(): number {
    return this.nextExpressId;
  }

  // =========================================================================
  // Formatting Helpers
  // =========================================================================

  /**
   * Format coordinate list as STEP tuple list
   */
  private formatCoordinateList(
    positions: Float32Array,
    precision: number
  ): string {
    const tuples: string[] = [];

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i].toFixed(precision);
      const y = positions[i + 1].toFixed(precision);
      const z = positions[i + 2].toFixed(precision);
      tuples.push(`(${x},${y},${z})`);
    }

    return tuples.join(',');
  }

  /**
   * Format normals list as STEP tuple list
   */
  private formatNormalsList(
    normals: Float32Array,
    precision: number
  ): string {
    const tuples: string[] = [];

    for (let i = 0; i < normals.length; i += 3) {
      const nx = normals[i].toFixed(precision);
      const ny = normals[i + 1].toFixed(precision);
      const nz = normals[i + 2].toFixed(precision);
      tuples.push(`(${nx},${ny},${nz})`);
    }

    return tuples.join(',');
  }

  /**
   * Format triangle indices as STEP index tuples
   * IFC indices are 1-based
   */
  private formatIndicesList(indices: Uint32Array): string {
    const tuples: string[] = [];

    for (let i = 0; i < indices.length; i += 3) {
      // Convert to 1-based indices for IFC
      const i0 = indices[i] + 1;
      const i1 = indices[i + 1] + 1;
      const i2 = indices[i + 2] + 1;
      tuples.push(`(${i0},${i1},${i2})`);
    }

    return tuples.join(',');
  }

  /**
   * Format a parameter value for STEP
   */
  private formatParameterValue(value: unknown): string {
    if (typeof value === 'number') {
      return value.toString().includes('.') ? value.toString() : value + '.';
    }

    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === 'boolean') {
      return value ? '.T.' : '.F.';
    }

    if (value === null || value === undefined) {
      return '$';
    }

    if (Array.isArray(value)) {
      const items = value.map((v) => this.formatParameterValue(v));
      return `(${items.join(',')})`;
    }

    if (typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if ('x' in v && 'y' in v) {
        if ('z' in v) {
          return `(${v.x},${v.y},${v.z})`;
        }
        return `(${v.x},${v.y})`;
      }
    }

    return '$';
  }
}

/**
 * Generate a new IFC GlobalId (22-character base64)
 */
export function generateGlobalId(): string {
  const chars =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  let result = '';
  for (let i = 0; i < 22; i++) {
    result += chars[Math.floor(Math.random() * 64)];
  }
  return result;
}

/**
 * Create an IFC4 geometry exporter
 */
export function createIfc4Exporter(
  options?: Partial<Ifc4ExportOptions>
): Ifc4GeometryExporter {
  return new Ifc4GeometryExporter(options);
}

/**
 * Quick export function for a single mesh
 */
export function meshToIfc4(
  mesh: MeshData,
  includeStyle: boolean = true
): string {
  const exporter = new Ifc4GeometryExporter();
  const result = includeStyle
    ? exporter.exportMeshWithStyle(mesh)
    : exporter.exportMesh(mesh);

  return result.entities.map((e) => e.line).join('\n');
}
