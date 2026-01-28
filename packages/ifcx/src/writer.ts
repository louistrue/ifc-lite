/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFCX (IFC5 JSON) file writer
 *
 * Exports IFC data to IFCX JSON format.
 */

import type { IfcxFile, IfcxNode, IfcxHeader } from './types.js';
import type { EntityTable, PropertyTable, PropertySet, SpatialHierarchy } from '@ifc-lite/data';
import type { MutablePropertyView } from '@ifc-lite/mutations';

/**
 * Options for IFCX export
 */
export interface IfcxExportOptions {
  /** Author name */
  author?: string;
  /** Data version identifier */
  dataVersion?: string;
  /** Include properties (default: true) */
  includeProperties?: boolean;
  /** Include geometry (default: false - geometry export not yet supported) */
  includeGeometry?: boolean;
  /** Pretty print JSON (default: true) */
  prettyPrint?: boolean;
  /** Apply mutations (default: true if mutation view provided) */
  applyMutations?: boolean;
}

/**
 * Data sources for IFCX export
 */
export interface IfcxExportData {
  /** Entity table */
  entities: EntityTable;
  /** Property table (optional if using mutation view) */
  properties?: PropertyTable;
  /** Spatial hierarchy */
  spatialHierarchy?: SpatialHierarchy;
  /** String table for lookups */
  strings?: { get(idx: number): string };
  /** Optional mutation view for property changes */
  mutationView?: MutablePropertyView;
  /** ID to path mapping (for round-trip scenarios) */
  idToPath?: Map<number, string>;
}

/**
 * Result of IFCX export
 */
export interface IfcxExportResult {
  /** JSON string content */
  content: string;
  /** Statistics */
  stats: {
    nodeCount: number;
    propertyCount: number;
    fileSize: number;
  };
}

/**
 * IFCX file writer
 */
export class IfcxWriter {
  private data: IfcxExportData;

  constructor(data: IfcxExportData) {
    this.data = data;
  }

  /**
   * Export to IFCX format
   */
  export(options: IfcxExportOptions = {}): IfcxExportResult {
    const header = this.createHeader(options);
    const nodes = this.collectNodes(options);

    const file: IfcxFile = {
      header,
      imports: [],
      schemas: {},
      data: nodes,
    };

    const content = options.prettyPrint !== false
      ? JSON.stringify(file, null, 2)
      : JSON.stringify(file);

    let propertyCount = 0;
    for (const node of nodes) {
      if (node.attributes) {
        propertyCount += Object.keys(node.attributes).length;
      }
    }

    return {
      content,
      stats: {
        nodeCount: nodes.length,
        propertyCount,
        fileSize: new TextEncoder().encode(content).length,
      },
    };
  }

  /**
   * Create IFCX header
   */
  private createHeader(options: IfcxExportOptions): IfcxHeader {
    return {
      id: this.generateId(),
      ifcxVersion: 'IFCX-1.0',
      dataVersion: options.dataVersion || '1.0.0',
      author: options.author || 'ifc-lite',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Collect all nodes for export
   */
  private collectNodes(options: IfcxExportOptions): IfcxNode[] {
    const nodes: IfcxNode[] = [];
    const { entities, spatialHierarchy, mutationView, idToPath } = this.data;

    // Process entities from table
    for (let i = 0; i < entities.count; i++) {
      const expressId = entities.expressId[i];
      const typeEnum = entities.typeEnum[i];

      // Get or generate path
      const path = idToPath?.get(expressId) || this.generatePath(expressId, typeEnum);

      // Get entity name
      const name = this.getString(entities.name[i]);
      const globalId = this.getString(entities.globalId[i]);

      // Build attributes
      const attributes: Record<string, unknown> = {};

      // Add IFC class
      const typeName = this.getTypeName(typeEnum);
      if (typeName) {
        attributes['bsi::ifc::class'] = { code: typeName };
      }

      // Add basic attributes
      if (globalId) {
        attributes['bsi::ifc::globalId'] = globalId;
      }
      if (name) {
        attributes['bsi::ifc::name'] = name;
      }

      const description = this.getString(entities.description[i]);
      if (description) {
        attributes['bsi::ifc::description'] = description;
      }

      // Add properties if requested
      if (options.includeProperties !== false) {
        const props = this.getPropertiesForEntity(expressId, options);
        for (const [key, value] of Object.entries(props)) {
          attributes[key] = value;
        }
      }

      const node: IfcxNode = {
        path,
        attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
      };

      // Add children based on spatial hierarchy
      const children = this.getChildrenForEntity(expressId, spatialHierarchy, idToPath);
      if (Object.keys(children).length > 0) {
        node.children = children;
      }

      nodes.push(node);
    }

    return nodes;
  }

  /**
   * Get properties for an entity
   */
  private getPropertiesForEntity(
    entityId: number,
    options: IfcxExportOptions
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const { mutationView, properties } = this.data;

    // Get properties from mutation view if available and applying mutations
    if (mutationView && options.applyMutations !== false) {
      const psets = mutationView.getForEntity(entityId);
      for (const pset of psets) {
        for (const prop of pset.properties) {
          const key = `user::${pset.name}::${prop.name}`;
          result[key] = prop.value;
        }
      }
    } else if (properties) {
      // Get properties from table
      const psets = properties.getForEntity(entityId);
      for (const pset of psets) {
        for (const prop of pset.properties) {
          const key = `user::${pset.name}::${prop.name}`;
          result[key] = prop.value;
        }
      }
    }

    return result;
  }

  /**
   * Get children relationships for an entity
   */
  private getChildrenForEntity(
    entityId: number,
    spatialHierarchy: SpatialHierarchy | undefined,
    idToPath: Map<number, string> | undefined
  ): Record<string, string | null> {
    const children: Record<string, string | null> = {};

    if (!spatialHierarchy) return children;

    // Check if this entity has contained elements
    const containedElements = spatialHierarchy.byStorey.get(entityId) ||
                              spatialHierarchy.byBuilding.get(entityId) ||
                              spatialHierarchy.bySite.get(entityId) ||
                              spatialHierarchy.bySpace.get(entityId);

    if (containedElements) {
      for (const childId of containedElements) {
        const childPath = idToPath?.get(childId) || `element:${childId}`;
        children[childPath] = null; // null means direct child
      }
    }

    return children;
  }

  /**
   * Get string from string table
   */
  private getString(idx: number): string {
    if (idx === 0 || !this.data.strings) return '';
    return this.data.strings.get(idx) || '';
  }

  /**
   * Get type name from enum
   */
  private getTypeName(typeEnum: number): string {
    // Map common type enums to IFC class names
    const typeMap: Record<number, string> = {
      1: 'IfcProject',
      2: 'IfcSite',
      3: 'IfcBuilding',
      4: 'IfcBuildingStorey',
      5: 'IfcSpace',
      10: 'IfcWall',
      11: 'IfcWallStandardCase',
      12: 'IfcDoor',
      13: 'IfcWindow',
      14: 'IfcSlab',
      15: 'IfcColumn',
      16: 'IfcBeam',
      17: 'IfcRoof',
      18: 'IfcStair',
      19: 'IfcRailing',
      20: 'IfcCurtainWall',
      21: 'IfcCovering',
      22: 'IfcPlate',
      23: 'IfcMember',
      24: 'IfcPile',
      25: 'IfcFooting',
      30: 'IfcFurnishingElement',
      31: 'IfcSystemFurnitureElement',
      32: 'IfcDistributionElement',
      33: 'IfcBuildingElementProxy',
      40: 'IfcOpeningElement',
    };

    return typeMap[typeEnum] || `IfcElement_${typeEnum}`;
  }

  /**
   * Generate path for an entity
   */
  private generatePath(expressId: number, typeEnum: number): string {
    const typeName = this.getTypeName(typeEnum);
    return `ifc:${typeName}.${expressId}`;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `ifcx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Quick export function for simple use cases
 */
export function exportToIfcx(
  data: IfcxExportData,
  options?: IfcxExportOptions
): string {
  const writer = new IfcxWriter(data);
  const result = writer.export(options);
  return result.content;
}
