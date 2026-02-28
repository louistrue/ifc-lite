/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC5 (IFCX) Exporter
 *
 * Converts an IfcDataStore (from IFC2X3/IFC4/IFC4X3 STEP files) to the
 * IFC5 IFCX JSON format with USD geometry.
 *
 * This performs full schema conversion:
 * - Entity type mapping to IFC5 (aligned with IFC4X3 naming)
 * - Properties converted to IFCX attribute namespaces
 * - Tessellated geometry converted to USD mesh format
 * - Spatial hierarchy mapped to IFCX path-based structure
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { MeshData, GeometryResult } from '@ifc-lite/geometry';
import {
  IfcTypeEnumToString,
  IfcTypeEnumFromString,
  type IfcTypeEnum,
  PropertyValueType,
} from '@ifc-lite/data';
import { convertEntityType, type IfcSchemaVersion } from './schema-converter.js';

// ============================================================================
// Types
// ============================================================================

/** Options for IFC5 export */
export interface Ifc5ExportOptions {
  /** Author name */
  author?: string;
  /** Data version identifier */
  dataVersion?: string;
  /** Include geometry as USD meshes (default: true) */
  includeGeometry?: boolean;
  /** Include properties (default: true) */
  includeProperties?: boolean;
  /** Apply mutations (default: true if mutation view provided) */
  applyMutations?: boolean;
  /** Pretty print JSON (default: true) */
  prettyPrint?: boolean;
  /** Only export visible entities */
  visibleOnly?: boolean;
  /** Hidden entity IDs (local expressIds) */
  hiddenEntityIds?: Set<number>;
  /** Isolated entity IDs (local expressIds, null = no isolation) */
  isolatedEntityIds?: Set<number> | null;
}

/** Result of IFC5 export */
export interface Ifc5ExportResult {
  /** IFCX JSON content */
  content: string;
  /** Statistics */
  stats: {
    nodeCount: number;
    propertyCount: number;
    meshCount: number;
    fileSize: number;
  };
}

/** IFCX file structure */
interface IfcxFileOutput {
  header: {
    id: string;
    ifcxVersion: string;
    dataVersion: string;
    author: string;
    timestamp: string;
  };
  imports: string[];
  schemas: Record<string, unknown>;
  data: IfcxNodeOutput[];
}

/** IFCX node in output */
interface IfcxNodeOutput {
  path: string;
  children?: Record<string, string | null>;
  inherits?: Record<string, string | null>;
  attributes?: Record<string, unknown>;
}

// ============================================================================
// Exporter
// ============================================================================

/**
 * Exports IFC data (from any schema) to IFC5 IFCX JSON format.
 */
export class Ifc5Exporter {
  private dataStore: IfcDataStore;
  private mutationView: MutablePropertyView | null;
  private geometryResult: GeometryResult | null;
  private idOffset: number;
  /** Unique path segment name per entity (with _<id> suffix when siblings collide) */
  private segmentNames = new Map<number, string>();
  /** Spatial container children (Project→Sites, Site→Buildings, etc.) */
  private spatialChildIds = new Map<number, number[]>();

  constructor(
    dataStore: IfcDataStore,
    geometryResult?: GeometryResult | null,
    mutationView?: MutablePropertyView,
    idOffset?: number,
  ) {
    this.dataStore = dataStore;
    this.geometryResult = geometryResult ?? null;
    this.mutationView = mutationView ?? null;
    this.idOffset = idOffset ?? 0;
  }

  /**
   * Export to IFCX JSON format
   */
  export(options: Ifc5ExportOptions = {}): Ifc5ExportResult {
    const sourceSchema = (this.dataStore.schemaVersion as IfcSchemaVersion) || 'IFC4';

    // Build entity path map using spatial hierarchy
    const entityPaths = this.buildEntityPaths();

    // Build mesh lookup by expressId
    const meshByEntity = this.buildMeshLookup(options);

    // Build visible set
    const visibleIds = this.buildVisibleSet(options);

    // Collect nodes
    const nodes: IfcxNodeOutput[] = [];
    let propertyCount = 0;
    let meshCount = 0;

    const { entities, strings } = this.dataStore;

    for (let i = 0; i < entities.count; i++) {
      const expressId = entities.expressId[i];

      // Visibility filter
      if (visibleIds && !visibleIds.has(expressId)) continue;

      const typeEnum = entities.typeEnum[i];
      const typeName = IfcTypeEnumToString(typeEnum as IfcTypeEnum) || `IfcElement_${typeEnum}`;

      // Convert entity type to IFC5 (aligned with IFC4X3)
      const ifc5Type = convertEntityType(
        typeName.toUpperCase(),
        sourceSchema,
        'IFC5',
      );
      // Convert back to PascalCase for IFCX
      const ifc5Class = stepTypeToClassName(ifc5Type);

      // Get path for this entity
      const path = entityPaths.get(expressId) || `ifc:${ifc5Class}.${expressId}`;

      // Build attributes
      const attributes: Record<string, unknown> = {};

      // IFC class
      attributes['bsi::ifc::class'] = { code: ifc5Class };

      // GlobalId
      const globalId = strings.get(entities.globalId[i]);
      if (globalId) {
        attributes['bsi::ifc::globalId'] = globalId;
      }

      // Name - use entity table name, or segment name from path building (has fallbacks)
      const name = strings.get(entities.name[i])
        || this.segmentNames.get(expressId)
        || ifc5Class;
      attributes['bsi::ifc::name'] = name;

      // Description
      const description = strings.get(entities.description[i]);
      if (description) {
        attributes['bsi::ifc::description'] = description;
      }

      // Properties
      if (options.includeProperties !== false) {
        const props = this.getPropertiesForEntity(expressId, options);
        for (const [key, value] of Object.entries(props)) {
          attributes[key] = value;
          propertyCount++;
        }
      }

      // Build node
      const node: IfcxNodeOutput = { path };

      // Children from spatial hierarchy
      const children = this.getChildrenForEntity(expressId, entityPaths);
      if (Object.keys(children).length > 0) {
        node.children = children;
      }

      // Geometry as USD mesh
      if (options.includeGeometry !== false) {
        const meshes = meshByEntity.get(expressId);
        if (meshes && meshes.length > 0) {
          const usdMesh = this.convertToUsdMesh(meshes);
          attributes['usd::usdgeom::mesh'] = usdMesh;

          // Color/presentation
          const [r, g, b, a] = meshes[0].color;
          attributes['bsi::ifc::presentation::diffuseColor'] = [r, g, b];
          if (a < 1.0) {
            attributes['bsi::ifc::presentation::opacity'] = a;
          }
          meshCount++;
        }
      }

      if (Object.keys(attributes).length > 0) {
        node.attributes = attributes;
      }

      nodes.push(node);
    }

    // Assemble IFCX file
    const file: IfcxFileOutput = {
      header: {
        id: `ifcx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        ifcxVersion: 'IFCX-1.0',
        dataVersion: options.dataVersion || '1.0.0',
        author: options.author || 'ifc-lite',
        timestamp: new Date().toISOString(),
      },
      imports: [],
      schemas: {},
      data: nodes,
    };

    const content = options.prettyPrint !== false
      ? JSON.stringify(file, null, 2)
      : JSON.stringify(file);

    return {
      content,
      stats: {
        nodeCount: nodes.length,
        propertyCount,
        meshCount,
        fileSize: new TextEncoder().encode(content).length,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Path building
  // --------------------------------------------------------------------------

  /**
   * Build path strings for all entities using the spatial hierarchy.
   * Paths follow IFCX convention: "0/SiteName/BuildingName/StoreyName/ElementName"
   */
  private buildEntityPaths(): Map<number, string> {
    const paths = new Map<number, string>();
    const { spatialHierarchy, entities, strings } = this.dataStore;
    if (!spatialHierarchy) return paths;

    // Build parent→children map from hierarchy
    const parentOf = new Map<number, number>();

    const processChildren = (parentId: number, childIds: Set<number> | number[] | undefined) => {
      if (!childIds) return;
      for (const childId of childIds) {
        parentOf.set(childId, parentId);
      }
    };

    // Add spatial container hierarchy from the project tree first
    // (Project→Site, Site→Building, Building→Storey, Storey→Space)
    // Also collect spatial node names (SpatialNode.name is often more reliable
    // than the entity table for spatial containers)
    this.spatialChildIds.clear();
    const spatialNodeNames = new Map<number, string>();
    if (spatialHierarchy.project) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const walkTree = (node: { expressId: number; name?: string; children: any[] }) => {
        if (node.name) {
          spatialNodeNames.set(node.expressId, node.name);
        }
        const childIds: number[] = [];
        for (const child of node.children) {
          parentOf.set(child.expressId, node.expressId);
          childIds.push(child.expressId);
          walkTree(child);
        }
        this.spatialChildIds.set(node.expressId, childIds);
      };
      walkTree(spatialHierarchy.project);
    }

    // Add element containment from flat maps (element→storey/building/site/space)
    if (spatialHierarchy.bySite) {
      for (const [siteId, children] of spatialHierarchy.bySite) {
        processChildren(siteId, children);
      }
    }
    if (spatialHierarchy.byBuilding) {
      for (const [buildingId, children] of spatialHierarchy.byBuilding) {
        processChildren(buildingId, children);
      }
    }
    if (spatialHierarchy.byStorey) {
      for (const [storeyId, children] of spatialHierarchy.byStorey) {
        processChildren(storeyId, children);
      }
    }
    if (spatialHierarchy.bySpace) {
      for (const [spaceId, children] of spatialHierarchy.bySpace) {
        processChildren(spaceId, children);
      }
    }

    // Build index lookup for entity names.
    // Priority: entity table name → spatial node name → IFC type name fallback
    const entityNameById = new Map<number, string>();
    for (let i = 0; i < entities.count; i++) {
      const id = entities.expressId[i];
      let name = strings.get(entities.name[i]) || '';
      // For entities with empty names, try spatial node name (from hierarchy tree)
      if (!name) {
        name = spatialNodeNames.get(id) || '';
      }
      // Last resort: use the IFC type name so paths are readable (e.g. "IfcProject")
      if (!name) {
        const typeName = IfcTypeEnumToString(entities.typeEnum[i] as IfcTypeEnum);
        if (typeName !== 'Unknown') {
          name = typeName;
        }
      }
      entityNameById.set(id, name);
    }

    // Build children-per-parent map so we can detect name collisions among siblings
    const childrenOf = new Map<number | undefined, number[]>();
    for (const [childId, parentId] of parentOf) {
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId)!.push(childId);
    }
    // Also collect root entities (those not in parentOf)
    for (let i = 0; i < entities.count; i++) {
      const id = entities.expressId[i];
      if (!parentOf.has(id)) {
        if (!childrenOf.has(undefined)) childrenOf.set(undefined, []);
        childrenOf.get(undefined)!.push(id);
      }
    }

    // Pre-compute unique segment names: append _<expressId> when siblings share a name
    this.segmentNames.clear();
    for (const [, siblings] of childrenOf) {
      // Count how many siblings share each sanitised name
      const nameCount = new Map<string, number>();
      for (const id of siblings) {
        const raw = entityNameById.get(id) || `e${id}`;
        const safe = raw.replace(/[/\\]/g, '_').replace(/\s+/g, '_');
        nameCount.set(safe, (nameCount.get(safe) || 0) + 1);
      }
      for (const id of siblings) {
        const raw = entityNameById.get(id) || `e${id}`;
        const safe = raw.replace(/[/\\]/g, '_').replace(/\s+/g, '_');
        this.segmentNames.set(id, nameCount.get(safe)! > 1 ? `${safe}_${id}` : safe);
      }
    }

    // Generate path for each entity by walking up to root
    const getPath = (expressId: number): string => {
      if (paths.has(expressId)) return paths.get(expressId)!;

      const segments: string[] = [];
      let current = expressId;
      const visited = new Set<number>();

      while (current !== undefined) {
        if (visited.has(current)) break; // cycle protection
        visited.add(current);

        segments.unshift(this.segmentNames.get(current) || `e${current}`);

        const parent = parentOf.get(current);
        if (parent === undefined) break;
        current = parent;
      }

      // Prefix with "0" (root index, per IFCX convention)
      const path = '0/' + segments.join('/');
      paths.set(expressId, path);
      return path;
    };

    for (let i = 0; i < entities.count; i++) {
      getPath(entities.expressId[i]);
    }

    return paths;
  }

  // --------------------------------------------------------------------------
  // Properties
  // --------------------------------------------------------------------------

  /**
   * Get properties for an entity, converted to IFCX attribute format.
   */
  private getPropertiesForEntity(
    entityId: number,
    options: Ifc5ExportOptions,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Prefer mutation view if available
    if (this.mutationView && options.applyMutations !== false) {
      const psets = this.mutationView.getForEntity(entityId);
      for (const pset of psets) {
        for (const prop of pset.properties) {
          const key = `bsi::ifc::prop::${pset.name}::${prop.name}`;
          result[key] = this.convertPropertyValue(prop.value, prop.type);
        }
      }
    } else if (this.dataStore.properties) {
      const psets = this.dataStore.properties.getForEntity(entityId);
      for (const pset of psets) {
        for (const prop of pset.properties) {
          const key = `bsi::ifc::prop::${pset.name}::${prop.name}`;
          result[key] = this.convertPropertyValue(prop.value, prop.type);
        }
      }
    }

    return result;
  }

  /**
   * Convert a property value to IFCX-compatible format.
   * IFCX uses native JSON types rather than IFC wrapped types.
   */
  private convertPropertyValue(value: unknown, type: PropertyValueType): unknown {
    if (value === null || value === undefined) return null;

    switch (type) {
      case PropertyValueType.Real:
        return Number(value);
      case PropertyValueType.Integer:
        return Math.round(Number(value));
      case PropertyValueType.Boolean:
      case PropertyValueType.Logical:
        return Boolean(value);
      default:
        return value;
    }
  }

  // --------------------------------------------------------------------------
  // Children
  // --------------------------------------------------------------------------

  /**
   * Get children for a spatial entity.
   * IFCX children format: { childName: childPath }
   */
  private getChildrenForEntity(
    entityId: number,
    entityPaths: Map<number, string>,
  ): Record<string, string | null> {
    const children: Record<string, string | null> = {};

    const addChild = (childId: number) => {
      const childPath = entityPaths.get(childId);
      if (!childPath) return;
      const childName = this.segmentNames.get(childId) || `e${childId}`;
      children[childName] = childPath;
    };

    // Spatial container children (Project→Sites, Site→Buildings, etc.)
    const spatialKids = this.spatialChildIds.get(entityId);
    if (spatialKids) {
      for (const childId of spatialKids) {
        addChild(childId);
      }
    }

    // Element children from containment maps
    const { spatialHierarchy } = this.dataStore;
    if (spatialHierarchy) {
      const childSets = [
        spatialHierarchy.bySite?.get(entityId),
        spatialHierarchy.byBuilding?.get(entityId),
        spatialHierarchy.byStorey?.get(entityId),
        spatialHierarchy.bySpace?.get(entityId),
      ];
      for (const childSet of childSets) {
        if (!childSet) continue;
        for (const childId of childSet) {
          addChild(childId);
        }
      }
    }

    return children;
  }

  // --------------------------------------------------------------------------
  // Geometry conversion
  // --------------------------------------------------------------------------

  /**
   * Build mesh lookup from GeometryResult, keyed by original expressId.
   */
  private buildMeshLookup(options: Ifc5ExportOptions): Map<number, MeshData[]> {
    const lookup = new Map<number, MeshData[]>();
    if (!this.geometryResult || options.includeGeometry === false) return lookup;

    for (const mesh of this.geometryResult.meshes) {
      // Convert global expressId back to original local expressId
      const localId = mesh.expressId - this.idOffset;
      const id = localId > 0 ? localId : mesh.expressId;

      if (!lookup.has(id)) {
        lookup.set(id, []);
      }
      lookup.get(id)!.push(mesh);
    }

    return lookup;
  }

  /**
   * Convert tessellated MeshData (Y-up) to USD mesh format (Z-up).
   * Merges multiple mesh fragments for the same entity.
   */
  private convertToUsdMesh(meshes: MeshData[]): {
    points: number[][];
    faceVertexIndices: number[];
    faceVertexCounts: number[];
    normals?: number[][];
  } {
    const allPoints: number[][] = [];
    const allIndices: number[] = [];
    const allFaceCounts: number[] = [];
    const allNormals: number[][] = [];
    let indexOffset = 0;

    for (const mesh of meshes) {
      // Convert positions from Y-up to Z-up
      // Y-up: X=right, Y=up, Z=back
      // Z-up: X=right, Y=forward, Z=up
      // Reverse of: Yx=Zx, Yy=Zz, Yz=-Zy
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i];
        const y = mesh.positions[i + 1];   // Y-up Y = Z-up Z
        const z = mesh.positions[i + 2];   // Y-up Z = -Z-up Y
        allPoints.push([x, -z, y]);
      }

      // Convert normals from Y-up to Z-up
      if (mesh.normals) {
        for (let i = 0; i < mesh.normals.length; i += 3) {
          const nx = mesh.normals[i];
          const ny = mesh.normals[i + 1];
          const nz = mesh.normals[i + 2];
          allNormals.push([nx, -nz, ny]);
        }
      }

      // Offset indices for merged mesh
      for (let i = 0; i < mesh.indices.length; i += 3) {
        allIndices.push(
          mesh.indices[i] + indexOffset,
          mesh.indices[i + 1] + indexOffset,
          mesh.indices[i + 2] + indexOffset,
        );
        allFaceCounts.push(3); // triangles
      }

      indexOffset += mesh.positions.length / 3;
    }

    const result: {
      points: number[][];
      faceVertexIndices: number[];
      faceVertexCounts: number[];
      normals?: number[][];
    } = {
      points: allPoints,
      faceVertexIndices: allIndices,
      faceVertexCounts: allFaceCounts,
    };

    if (allNormals.length > 0) {
      result.normals = allNormals;
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Visibility
  // --------------------------------------------------------------------------

  /**
   * Build visible entity set if visibility filtering is requested.
   */
  private buildVisibleSet(options: Ifc5ExportOptions): Set<number> | null {
    if (!options.visibleOnly) return null;

    const hidden = options.hiddenEntityIds ?? new Set<number>();
    const isolated = options.isolatedEntityIds ?? null;
    const visible = new Set<number>();

    const { entities } = this.dataStore;

    for (let i = 0; i < entities.count; i++) {
      const id = entities.expressId[i];
      if (isolated) {
        // When isolation is active, only isolated entities are visible
        if (isolated.has(id)) visible.add(id);
      } else {
        // Otherwise, everything except hidden is visible
        if (!hidden.has(id)) visible.add(id);
      }
    }

    return visible;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert STEP uppercase type name (e.g. "IFCWALL") to PascalCase class name (e.g. "IfcWall").
 * Uses the IFC type enum lookup for canonical casing (e.g. "IfcRelAggregates", not "Ifcrelaggregates").
 */
function stepTypeToClassName(stepType: string): string {
  const enumVal = IfcTypeEnumFromString(stepType);
  const name = IfcTypeEnumToString(enumVal);
  if (name !== 'Unknown') return name;
  // Fallback for types not in the enum: simple prefix normalisation
  const lower = stepType.toLowerCase();
  if (lower.startsWith('ifc')) {
    return 'Ifc' + lower.charAt(3).toUpperCase() + lower.slice(4);
  }
  return stepType;
}
