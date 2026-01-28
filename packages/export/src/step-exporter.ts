/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC STEP file exporter
 *
 * Exports IFC data store to ISO 10303-21 STEP format.
 * Supports applying property mutations before export.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import {
  generateHeader,
  serializeValue,
  ref,
  enumVal,
  type StepValue,
  type StepEntity,
} from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import type { PropertySet, Property } from '@ifc-lite/data';
import { PropertyValueType } from '@ifc-lite/data';

/**
 * Options for STEP export
 */
export interface StepExportOptions {
  /** IFC schema version */
  schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  /** File description */
  description?: string;
  /** Author name */
  author?: string;
  /** Organization name */
  organization?: string;
  /** Application name (defaults to 'ifc-lite') */
  application?: string;
  /** Output filename */
  filename?: string;

  /** Include original geometry entities (default: true) */
  includeGeometry?: boolean;
  /** Include property sets (default: true) */
  includeProperties?: boolean;
  /** Include quantity sets (default: true) */
  includeQuantities?: boolean;
  /** Include relationships (default: true) */
  includeRelationships?: boolean;

  /** Apply mutations from MutablePropertyView (default: true if provided) */
  applyMutations?: boolean;
  /** Only export entities with mutations (delta export) */
  deltaOnly?: boolean;
}

/**
 * Result of STEP export
 */
export interface StepExportResult {
  /** STEP file content */
  content: string;
  /** Statistics about the export */
  stats: {
    /** Total entities exported */
    entityCount: number;
    /** New entities created for mutations */
    newEntityCount: number;
    /** Entities modified by mutations */
    modifiedEntityCount: number;
    /** File size in bytes */
    fileSize: number;
  };
}

/**
 * IFC STEP file exporter
 */
export class StepExporter {
  private dataStore: IfcDataStore;
  private mutationView: MutablePropertyView | null;
  private nextExpressId: number;

  constructor(dataStore: IfcDataStore, mutationView?: MutablePropertyView) {
    this.dataStore = dataStore;
    this.mutationView = mutationView || null;
    // Start new IDs after the highest existing ID
    this.nextExpressId = this.findMaxExpressId() + 1;
  }

  /**
   * Export to STEP format
   */
  export(options: StepExportOptions): StepExportResult {
    const entities: string[] = [];
    let newEntityCount = 0;
    let modifiedEntityCount = 0;

    // Determine schema from data store if not specified
    const schema = options.schema || (this.dataStore.schemaVersion as 'IFC2X3' | 'IFC4' | 'IFC4X3') || 'IFC4';

    // Generate header
    const header = generateHeader({
      schema,
      description: options.description || 'Exported from ifc-lite',
      author: options.author || '',
      organization: options.organization || '',
      application: options.application || 'ifc-lite',
      filename: options.filename || 'export.ifc',
    });

    // Collect entities that need to be modified or created
    const modifiedEntities = new Set<number>();
    const newPropertySets: Array<{ entityId: number; psets: PropertySet[] }> = [];

    // Process mutations if we have a mutation view
    if (this.mutationView && (options.applyMutations !== false)) {
      const mutations = this.mutationView.getMutations();

      // Group mutations by entity
      const entityMutations = new Map<number, Set<string>>();
      for (const mutation of mutations) {
        if (!entityMutations.has(mutation.entityId)) {
          entityMutations.set(mutation.entityId, new Set());
        }
        if (mutation.psetName) {
          entityMutations.get(mutation.entityId)!.add(mutation.psetName);
        }
      }

      // Collect modified property sets
      for (const [entityId, psetNames] of entityMutations) {
        modifiedEntities.add(entityId);
        modifiedEntityCount++;

        // Get the mutated property sets for this entity
        const allPsets = this.mutationView.getForEntity(entityId);
        const relevantPsets = allPsets.filter(pset => psetNames.has(pset.name));

        if (relevantPsets.length > 0) {
          newPropertySets.push({ entityId, psets: relevantPsets });
        }
      }
    }

    // If delta only, only export modified entities
    if (options.deltaOnly && modifiedEntities.size === 0) {
      return {
        content: header + 'DATA;\nENDSEC;\nEND-ISO-10303-21;\n',
        stats: {
          entityCount: 0,
          newEntityCount: 0,
          modifiedEntityCount: 0,
          fileSize: 0,
        },
      };
    }

    // Export original entities from source buffer
    if (!options.deltaOnly && this.dataStore.source) {
      const decoder = new TextDecoder();
      const source = this.dataStore.source;

      // Extract existing entities from source
      for (const [expressId, entityRef] of this.dataStore.entityIndex.byId) {
        // Skip if we're only doing geometry or specific types
        const entityType = entityRef.type.toUpperCase();

        // Skip geometry if not included
        if (options.includeGeometry === false && this.isGeometryEntity(entityType)) {
          continue;
        }

        // Get original entity text
        const entityText = decoder.decode(
          source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
        );

        entities.push(entityText);
      }
    }

    // Generate new property entities for mutations
    for (const { entityId, psets } of newPropertySets) {
      const newEntities = this.generatePropertySetEntities(entityId, psets);
      entities.push(...newEntities.lines);
      newEntityCount += newEntities.count;
    }

    // Assemble final file
    const dataSection = entities.join('\n');
    const content = `${header}DATA;\n${dataSection}\nENDSEC;\nEND-ISO-10303-21;\n`;

    return {
      content,
      stats: {
        entityCount: entities.length,
        newEntityCount,
        modifiedEntityCount,
        fileSize: new TextEncoder().encode(content).length,
      },
    };
  }

  /**
   * Export only property/quantity changes (lightweight export)
   */
  exportPropertiesOnly(options: Omit<StepExportOptions, 'includeGeometry'>): StepExportResult {
    return this.export({
      ...options,
      includeGeometry: false,
      deltaOnly: true,
    });
  }

  /**
   * Generate STEP entities for property sets
   */
  private generatePropertySetEntities(
    entityId: number,
    psets: PropertySet[]
  ): { lines: string[]; count: number } {
    const lines: string[] = [];
    let count = 0;

    for (const pset of psets) {
      const propertyIds: number[] = [];

      // Create IfcPropertySingleValue for each property
      for (const prop of pset.properties) {
        const propId = this.nextExpressId++;
        count++;

        const valueStr = this.serializePropertyValue(prop.value, prop.type);
        const unitStr = prop.unit ? ref(this.findUnitId(prop.unit)) : null;

        // #ID=IFCPROPERTYSINGLEVALUE('Name',$,Value,Unit);
        const line = `#${propId}=IFCPROPERTYSINGLEVALUE('${this.escapeStepString(prop.name)}',$,${valueStr},${unitStr ? serializeValue(unitStr) : '$'});`;
        lines.push(line);
        propertyIds.push(propId);
      }

      // Create IfcPropertySet
      const psetId = this.nextExpressId++;
      count++;

      const propRefs = propertyIds.map(id => `#${id}`).join(',');
      const globalId = this.generateGlobalId();

      // #ID=IFCPROPERTYSET('GlobalId',$,'Name',$,(#props));
      const psetLine = `#${psetId}=IFCPROPERTYSET('${globalId}',$,'${this.escapeStepString(pset.name)}',$,(${propRefs}));`;
      lines.push(psetLine);

      // Create IfcRelDefinesByProperties to link pset to entity
      const relId = this.nextExpressId++;
      count++;

      const relGlobalId = this.generateGlobalId();
      // #ID=IFCRELDEFINESBYPROPERTIES('GlobalId',$,$,$,(#entity),#pset);
      const relLine = `#${relId}=IFCRELDEFINESBYPROPERTIES('${relGlobalId}',$,$,$,(#${entityId}),#${psetId});`;
      lines.push(relLine);
    }

    return { lines, count };
  }

  /**
   * Serialize a property value to STEP format
   */
  private serializePropertyValue(value: unknown, type: PropertyValueType): string {
    if (value === null || value === undefined) {
      return '$';
    }

    switch (type) {
      case PropertyValueType.String:
      case PropertyValueType.Label:
      case PropertyValueType.Text:
        return `IFCLABEL('${this.escapeStepString(String(value))}')`;

      case PropertyValueType.Identifier:
        return `IFCIDENTIFIER('${this.escapeStepString(String(value))}')`;

      case PropertyValueType.Real:
        const num = Number(value);
        if (!Number.isFinite(num)) return '$';
        return `IFCREAL(${num.toString().includes('.') ? num : num + '.'})`;

      case PropertyValueType.Integer:
        return `IFCINTEGER(${Math.round(Number(value))})`;

      case PropertyValueType.Boolean:
      case PropertyValueType.Logical:
        if (value === true) return `IFCBOOLEAN(.T.)`;
        if (value === false) return `IFCBOOLEAN(.F.)`;
        return `IFCLOGICAL(.U.)`;

      case PropertyValueType.Enum:
        return `.${String(value).toUpperCase()}.`;

      case PropertyValueType.List:
        if (Array.isArray(value)) {
          const items = value.map(v => this.serializePropertyValue(v, PropertyValueType.String));
          return `(${items.join(',')})`;
        }
        return '$';

      default:
        return `IFCLABEL('${this.escapeStepString(String(value))}')`;
    }
  }

  /**
   * Escape a string for STEP format
   */
  private escapeStepString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''");
  }

  /**
   * Generate a new IFC GlobalId (22 character base64)
   */
  private generateGlobalId(): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
    let result = '';
    for (let i = 0; i < 22; i++) {
      result += chars[Math.floor(Math.random() * 64)];
    }
    return result;
  }

  /**
   * Find the maximum EXPRESS ID in the data store
   */
  private findMaxExpressId(): number {
    let max = 0;
    for (const [id] of this.dataStore.entityIndex.byId) {
      if (id > max) max = id;
    }
    return max;
  }

  /**
   * Find a unit entity ID by name (simplified - returns null for now)
   */
  private findUnitId(_unitName: string): number {
    // TODO: Implement unit lookup from data store
    return 0;
  }

  /**
   * Check if an entity type is a geometry-related type
   */
  private isGeometryEntity(type: string): boolean {
    const geometryTypes = new Set([
      'IFCCARTESIANPOINT',
      'IFCDIRECTION',
      'IFCAXIS2PLACEMENT2D',
      'IFCAXIS2PLACEMENT3D',
      'IFCLOCALPLACEMENT',
      'IFCSHAPEREPRESENTATION',
      'IFCPRODUCTDEFINITIONSHAPE',
      'IFCGEOMETRICREPRESENTATIONCONTEXT',
      'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
      'IFCEXTRUDEDAREASOLID',
      'IFCFACETEDBREP',
      'IFCPOLYLOOP',
      'IFCFACE',
      'IFCFACEOUTERBOUND',
      'IFCCLOSEDSHELL',
      'IFCRECTANGLEPROFILEDEF',
      'IFCCIRCLEPROFILEDEF',
      'IFCARBITRARYCLOSEDPROFILEDEF',
      'IFCPOLYLINE',
      'IFCTRIMMEDCURVE',
      'IFCBSPLINECURVE',
      'IFCBSPLINESURFACE',
      'IFCTRIANGULATEDFACESET',
      'IFCPOLYGONALFACE',
      'IFCINDEXEDPOLYGONALFACE',
      'IFCPOLYGONALFACESET',
      'IFCSTYLEDITEM',
      'IFCPRESENTATIONSTYLEASSIGNMENT',
      'IFCSURFACESTYLE',
      'IFCSURFACESTYLERENDERING',
      'IFCCOLOURRGB',
    ]);
    return geometryTypes.has(type);
  }
}

/**
 * Quick export function for simple use cases
 */
export function exportToStep(
  dataStore: IfcDataStore,
  options?: Partial<StepExportOptions>
): string {
  const exporter = new StepExporter(dataStore);
  const result = exporter.export({
    schema: 'IFC4',
    ...options,
  });
  return result.content;
}
