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
import type { MeshData, CoordinateInfo, Vec3 } from '@ifc-lite/geometry';

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
    /** Entities with geometry changes */
    geometryChangedCount: number;
    /** File size in bytes */
    fileSize: number;
  };
}

/**
 * Geometry mutations - map from expressId to edited MeshData
 */
export type GeometryMutations = Map<number, MeshData>;

/**
 * IFC STEP file exporter
 */
export class StepExporter {
  private dataStore: IfcDataStore;
  private mutationView: MutablePropertyView | null;
  private geometryMutations: GeometryMutations;
  private coordinateInfo: CoordinateInfo | null;
  private nextExpressId: number;

  constructor(
    dataStore: IfcDataStore,
    mutationView?: MutablePropertyView,
    geometryMutations?: GeometryMutations,
    coordinateInfo?: CoordinateInfo
  ) {
    this.dataStore = dataStore;
    this.mutationView = mutationView || null;
    this.geometryMutations = geometryMutations || new Map();
    this.coordinateInfo = coordinateInfo || null;
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
    let geometryChangedCount = 0;

    // Determine schema from data store if not specified
    const schema = options.schema || (this.dataStore.schemaVersion as 'IFC2X3' | 'IFC4' | 'IFC4X3') || 'IFC4';
    console.log(`[StepExporter] Exporting with schema: ${schema}, geometry mutations: ${this.geometryMutations.size}`);

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
    const modifiedPsets = new Map<number, Set<string>>(); // entityId -> psetNames being modified
    const newPropertySets: Array<{ entityId: number; psets: PropertySet[] }> = [];

    // Track property set IDs and relationship IDs to skip
    const skipPropertySetIds = new Set<number>();
    const skipRelationshipIds = new Set<number>();

    // Track geometry entities to skip and entities needing new geometry
    const skipGeometryEntityIds = new Set<number>();
    const entitiesWithGeometryChanges = new Map<number, { meshData: MeshData; representationId: number | null }>();

    // Map to track entity text replacements (for updating Representation attribute)
    const entityReplacements = new Map<number, string>();

    // Process geometry mutations - MUST happen before entity export loop
    // so we can create entity replacements with updated representation references
    if (this.geometryMutations.size > 0) {
      for (const [expressId, meshData] of this.geometryMutations) {
        // Find the entity's representation (IfcProductDefinitionShape)
        const representationId = this.findEntityRepresentation(expressId);
        entitiesWithGeometryChanges.set(expressId, { meshData, representationId });
        geometryChangedCount++;

        if (representationId) {
          // Find all geometry entities referenced by this representation and mark for skip
          const geomEntityIds = this.findGeometryEntitiesForRepresentation(representationId);
          for (const geomId of geomEntityIds) {
            skipGeometryEntityIds.add(geomId);
          }
        }
      }

      // Pre-generate geometry entities and create entity replacements
      // This ensures the entities are updated to reference new geometry
      for (const [expressId, { meshData, representationId }] of entitiesWithGeometryChanges) {
        const newGeomEntities = this.generateGeometryEntities(expressId, meshData, representationId);
        entities.push(...newGeomEntities.lines);
        newEntityCount += newGeomEntities.count;

        // If we have a new product definition shape ID and an old one,
        // create a replacement for the entity
        if (newGeomEntities.newProductDefShapeId && representationId) {
          const replacement = this.createEntityReplacementWithNewRepresentation(
            expressId,
            representationId,
            newGeomEntities.newProductDefShapeId
          );
          if (replacement) {
            entityReplacements.set(expressId, replacement);
          }
        }
      }
    }

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

      // Collect modified property sets and find original psets to skip
      for (const [entityId, psetNames] of entityMutations) {
        modifiedEntities.add(entityId);
        modifiedPsets.set(entityId, psetNames);
        modifiedEntityCount++;

        // Get the FULL mutated property sets for this entity (merged base + mutations)
        const allPsets = this.mutationView.getForEntity(entityId);
        const relevantPsets = allPsets.filter(pset => psetNames.has(pset.name));

        if (relevantPsets.length > 0) {
          newPropertySets.push({ entityId, psets: relevantPsets });
        }

        // Find original property set IDs and relationship IDs to skip
        // Look for IfcRelDefinesByProperties that reference this entity
        for (const [relId, relRef] of this.dataStore.entityIndex.byId) {
          const relType = relRef.type.toUpperCase();
          if (relType === 'IFCRELDEFINESBYPROPERTIES') {
            // Parse the relationship to check if it references our entity
            const relatedEntities = this.getRelatedEntities(relId);
            const relatedPsetId = this.getRelatedPropertySet(relId);

            if (relatedEntities.includes(entityId) && relatedPsetId) {
              // Check if this pset is one we're modifying
              const psetName = this.getPropertySetName(relatedPsetId);
              if (psetName && psetNames.has(psetName)) {
                skipRelationshipIds.add(relId);
                skipPropertySetIds.add(relatedPsetId);
                // Also skip the individual properties in this pset
                const propIds = this.getPropertyIdsInSet(relatedPsetId);
                for (const propId of propIds) {
                  skipPropertySetIds.add(propId);
                }
              }
            }
          }
        }
      }
    }

    // If delta only, only export modified entities
    if (options.deltaOnly && modifiedEntities.size === 0 && this.geometryMutations.size === 0) {
      return {
        content: header + 'DATA;\nENDSEC;\nEND-ISO-10303-21;\n',
        stats: {
          entityCount: 0,
          newEntityCount: 0,
          modifiedEntityCount: 0,
          geometryChangedCount: 0,
          fileSize: 0,
        },
      };
    }

    // Export original entities from source buffer, SKIPPING modified property sets and geometry
    if (!options.deltaOnly && this.dataStore.source) {
      const decoder = new TextDecoder();
      const source = this.dataStore.source;

      // Extract existing entities from source
      for (const [expressId, entityRef] of this.dataStore.entityIndex.byId) {
        // Skip property sets/relationships that are being replaced
        if (skipPropertySetIds.has(expressId) || skipRelationshipIds.has(expressId)) {
          continue;
        }

        // Skip geometry entities that are being replaced
        if (skipGeometryEntityIds.has(expressId)) {
          continue;
        }

        // Skip if we're only doing geometry or specific types
        const entityType = entityRef.type.toUpperCase();

        // Skip geometry if not included
        if (options.includeGeometry === false && this.isGeometryEntity(entityType)) {
          continue;
        }

        // Get original entity text
        let entityText = decoder.decode(
          source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
        );

        // Check if this entity has a replacement (e.g., updated Representation)
        if (entityReplacements.has(expressId)) {
          entityText = entityReplacements.get(expressId)!;
        }

        entities.push(entityText);
      }
    }

    // Generate new property entities for mutations (these REPLACE the skipped ones)
    for (const { entityId, psets } of newPropertySets) {
      const newEntities = this.generatePropertySetEntities(entityId, psets);
      entities.push(...newEntities.lines);
      newEntityCount += newEntities.count;
    }

    // Note: Geometry entities were already generated earlier in the process
    // (before the entity export loop) to enable entity replacement with new representation references

    // Assemble final file
    const dataSection = entities.join('\n');
    const content = `${header}DATA;\n${dataSection}\nENDSEC;\nEND-ISO-10303-21;\n`;

    return {
      content,
      stats: {
        entityCount: entities.length,
        newEntityCount,
        modifiedEntityCount,
        geometryChangedCount,
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

  /**
   * Get entity IDs related by IfcRelDefinesByProperties (the related objects)
   */
  private getRelatedEntities(relId: number): number[] {
    const entityRef = this.dataStore.entityIndex.byId.get(relId);
    if (!entityRef || !this.dataStore.source) return [];

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Parse IfcRelDefinesByProperties: #ID=IFCRELDEFINESBYPROPERTIES('guid',$,$,$,(#objects),#pset);
    // The 5th argument (index 4) is the list of related objects
    const match = entityText.match(/\(([^)]+)\)\s*,\s*#(\d+)\s*\)\s*;/);
    if (!match) return [];

    const objectsList = match[1];
    const refs: number[] = [];
    const refMatches = objectsList.matchAll(/#(\d+)/g);
    for (const m of refMatches) {
      refs.push(parseInt(m[1], 10));
    }
    return refs;
  }

  /**
   * Get the property set ID from IfcRelDefinesByProperties
   */
  private getRelatedPropertySet(relId: number): number | null {
    const entityRef = this.dataStore.entityIndex.byId.get(relId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Last #ID before the closing );
    const match = entityText.match(/,\s*#(\d+)\s*\)\s*;$/);
    if (!match) return null;
    return parseInt(match[1], 10);
  }

  /**
   * Get the name of a property set by parsing the entity
   */
  private getPropertySetName(psetId: number): string | null {
    const entityRef = this.dataStore.entityIndex.byId.get(psetId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Parse: IFCPROPERTYSET('guid',$,'Name',$,...) - Name is 3rd argument
    const match = entityText.match(/IFCPROPERTYSET\s*\([^,]*,[^,]*,'([^']*)'/i);
    if (!match) return null;
    return match[1];
  }

  /**
   * Get IDs of properties in a property set
   */
  private getPropertyIdsInSet(psetId: number): number[] {
    const entityRef = this.dataStore.entityIndex.byId.get(psetId);
    if (!entityRef || !this.dataStore.source) return [];

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Parse: IFCPROPERTYSET(...,(#prop1,#prop2,...)); - Last argument is properties list
    const match = entityText.match(/\(\s*(#[^)]+)\s*\)\s*\)\s*;$/);
    if (!match) return [];

    const propsList = match[1];
    const ids: number[] = [];
    const refMatches = propsList.matchAll(/#(\d+)/g);
    for (const m of refMatches) {
      ids.push(parseInt(m[1], 10));
    }
    return ids;
  }

  // =========================================================================
  // Geometry Mutation Methods
  // =========================================================================

  /**
   * Find the IfcProductDefinitionShape ID for an entity
   */
  private findEntityRepresentation(entityId: number): number | null {
    const entityRef = this.dataStore.entityIndex.byId.get(entityId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Look for Representation attribute (typically 6th or 7th argument)
    // Pattern: ...#placementId,#representationId,...) or ...$,#representationId,...)
    const refMatches = [...entityText.matchAll(/#(\d+)/g)];

    // For IFC products, the representation is typically the second-to-last reference
    // Let's find it by checking which reference is an IfcProductDefinitionShape
    for (const match of refMatches) {
      const refId = parseInt(match[1], 10);
      const refEntity = this.dataStore.entityIndex.byId.get(refId);
      if (refEntity && refEntity.type.toUpperCase() === 'IFCPRODUCTDEFINITIONSHAPE') {
        return refId;
      }
    }
    return null;
  }

  /**
   * Find all geometry entity IDs referenced by a representation
   * This recursively finds all entities that should be replaced
   */
  private findGeometryEntitiesForRepresentation(representationId: number): Set<number> {
    const entityIds = new Set<number>();
    const toProcess = [representationId];
    const processed = new Set<number>();

    while (toProcess.length > 0) {
      const currentId = toProcess.pop()!;
      if (processed.has(currentId)) continue;
      processed.add(currentId);

      const entityRef = this.dataStore.entityIndex.byId.get(currentId);
      if (!entityRef || !this.dataStore.source) continue;

      const entityType = entityRef.type.toUpperCase();

      // Only include geometry-related entities
      if (this.isGeometryEntity(entityType) ||
          entityType === 'IFCPRODUCTDEFINITIONSHAPE' ||
          entityType === 'IFCCARTESIANPOINTLIST3D') {
        entityIds.add(currentId);
      }

      // Parse entity text to find references
      const decoder = new TextDecoder();
      const entityText = decoder.decode(
        this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
      );

      // Find all references in this entity
      const refMatches = entityText.matchAll(/#(\d+)/g);
      for (const match of refMatches) {
        const refId = parseInt(match[1], 10);
        if (!processed.has(refId)) {
          const refEntity = this.dataStore.entityIndex.byId.get(refId);
          if (refEntity) {
            const refType = refEntity.type.toUpperCase();
            // Only follow geometry-related references
            if (this.isGeometryEntity(refType) ||
                refType === 'IFCCARTESIANPOINTLIST3D' ||
                refType === 'IFCPRODUCTDEFINITIONSHAPE') {
              toProcess.push(refId);
            }
          }
        }
      }
    }

    return entityIds;
  }

  /**
   * Generate new geometry entities for an edited mesh
   * Returns IfcTriangulatedFaceSet with supporting entities and the new IfcProductDefinitionShape ID
   */
  private generateGeometryEntities(
    entityId: number,
    meshData: MeshData,
    _originalRepresentationId: number | null
  ): { lines: string[]; count: number; newProductDefShapeId: number } {
    const lines: string[] = [];
    let count = 0;
    const precision = 6;

    // Get entity's placement transform and compute inverse
    // The mesh positions are in world coordinates (after placement was applied during extraction)
    // We need to transform them back to local coordinates (before placement) for correct export
    const placementMatrix = this.getEntityPlacementMatrix(entityId);
    const inverseMatrix = placementMatrix ? this.invertMatrix4x4(placementMatrix) : null;

    if (inverseMatrix) {
      console.log(`[StepExporter] Applying inverse placement transform for entity #${entityId}`);
    }

    // Generate IfcCartesianPointList3D for coordinates
    const coordListId = this.nextExpressId++;
    count++;
    const coordinates = this.formatCoordinateList(meshData.positions, precision, inverseMatrix);
    const coordLine = `#${coordListId}=IFCCARTESIANPOINTLIST3D((${coordinates}));`;
    lines.push(coordLine);

    // Log first few coordinates for debugging
    const firstCoords = coordinates.split(',').slice(0, 3).join(',');
    console.log(`[StepExporter] First 3 coordinates: ${firstCoords}...`);
    console.log(`[StepExporter] Total vertices: ${meshData.positions.length / 3}, triangles: ${meshData.indices.length / 3}`);

    // Generate IfcTriangulatedFaceSet
    const faceSetId = this.nextExpressId++;
    count++;
    const indices = this.formatIndicesList(meshData.indices);
    // IfcTriangulatedFaceSet(Coordinates, Normals, Closed, CoordIndex, NormalIndex)
    const faceSetLine = `#${faceSetId}=IFCTRIANGULATEDFACESET(#${coordListId},$,.U.,(${indices}),$);`;
    lines.push(faceSetLine);
    console.log(`[StepExporter] Generated IfcTriangulatedFaceSet #${faceSetId} with #${coordListId}`);

    // Generate color if available
    if (meshData.color) {
      const [r, g, b, a] = meshData.color;

      // IfcColourRgb
      const colorId = this.nextExpressId++;
      count++;
      lines.push(`#${colorId}=IFCCOLOURRGB($,${r.toFixed(4)},${g.toFixed(4)},${b.toFixed(4)});`);

      // IfcSurfaceStyleRendering
      const renderingId = this.nextExpressId++;
      count++;
      const transparency = 1 - a;
      lines.push(`#${renderingId}=IFCSURFACESTYLERENDERING(#${colorId},${transparency.toFixed(4)},$,$,$,$,$,$,.NOTDEFINED.);`);

      // IfcSurfaceStyle
      const surfaceStyleId = this.nextExpressId++;
      count++;
      lines.push(`#${surfaceStyleId}=IFCSURFACESTYLE($,.BOTH.,(#${renderingId}));`);

      // IfcStyledItem
      const styledItemId = this.nextExpressId++;
      count++;
      lines.push(`#${styledItemId}=IFCSTYLEDITEM(#${faceSetId},(#${surfaceStyleId}),$);`);
    }

    // Generate IfcShapeRepresentation
    const shapeRepId = this.nextExpressId++;
    count++;
    // Find SubContext for 'Body' representation (or fall back to main context)
    const contextId = this.findBodyRepresentationContext() || this.findGeometricRepresentationContext() || 1;
    console.log(`[StepExporter] Using context #${contextId} for shape representation`);
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${contextId},'Body','Tessellation',(#${faceSetId}));`);

    // Generate IfcProductDefinitionShape
    const productDefShapeId = this.nextExpressId++;
    count++;
    lines.push(`#${productDefShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

    // Add comment for traceability
    lines.push(`/* Geometry replaced for entity #${entityId} */`);

    return { lines, count, newProductDefShapeId: productDefShapeId };
  }

  /**
   * Create a replacement entity text with updated representation reference
   * This replaces the old representation ID with the new one in the entity definition
   */
  private createEntityReplacementWithNewRepresentation(
    entityId: number,
    oldRepresentationId: number,
    newRepresentationId: number
  ): string | null {
    const entityRef = this.dataStore.entityIndex.byId.get(entityId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Replace the old representation reference with the new one
    const oldRef = `#${oldRepresentationId}`;
    const newRef = `#${newRepresentationId}`;

    if (!entityText.includes(oldRef)) {
      console.warn(`[StepExporter] Entity #${entityId} does not contain reference to representation #${oldRepresentationId}`);
      return null;
    }

    const replacement = entityText.replace(oldRef, newRef);
    console.log(`[StepExporter] Created replacement for entity #${entityId}: ${oldRef} -> ${newRef}`);
    return replacement;
  }

  /**
   * Format coordinate list as STEP tuple list
   * Applies inverse origin shift and inverse placement transform to convert from viewer coords to local entity coords
   * Also converts from Y-up (viewer) to Z-up (IFC) coordinate system
   */
  private formatCoordinateList(
    positions: Float32Array,
    precision: number,
    inversePlacementMatrix: number[] | null = null
  ): string {
    const tuples: string[] = [];
    // Get origin shift (need to add it back to get world coordinates)
    const shift = this.coordinateInfo?.originShift || { x: 0, y: 0, z: 0 };

    console.log(`[StepExporter] Applying inverse origin shift: (${shift.x}, ${shift.y}, ${shift.z})`);

    for (let i = 0; i < positions.length; i += 3) {
      // Start with viewer coordinates (Y-up)
      let x = positions[i] + shift.x;
      let y = positions[i + 1] + shift.y;
      let z = positions[i + 2] + shift.z;

      // Apply inverse placement transform FIRST (in Y-up space)
      // This removes the placement transform that was applied during geometry extraction
      if (inversePlacementMatrix) {
        const m = inversePlacementMatrix;
        const newX = m[0] * x + m[4] * y + m[8] * z + m[12];
        const newY = m[1] * x + m[5] * y + m[9] * z + m[13];
        const newZ = m[2] * x + m[6] * y + m[10] * z + m[14];
        x = newX;
        y = newY;
        z = newZ;
      }

      // THEN convert from Y-up (viewer) to Z-up (IFC) coordinate system
      // Y-up: X right, Y up, Z towards viewer
      // Z-up: X right, Y forward, Z up
      // Transformation: IFC_X = Viewer_X, IFC_Y = -Viewer_Z, IFC_Z = Viewer_Y
      const ifcX = x;
      const ifcY = -z;
      const ifcZ = y;

      tuples.push(`(${ifcX.toFixed(precision)},${ifcY.toFixed(precision)},${ifcZ.toFixed(precision)})`);
    }
    return tuples.join(',');
  }

  /**
   * Format triangle indices as STEP index tuples (1-based for IFC)
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
   * Find the geometric representation context ID in the model
   */
  private findGeometricRepresentationContext(): number | null {
    for (const [id, entityRef] of this.dataStore.entityIndex.byId) {
      if (entityRef.type.toUpperCase() === 'IFCGEOMETRICREPRESENTATIONCONTEXT') {
        return id;
      }
    }
    return null;
  }

  /**
   * Find the SubContext for 'Body' representations
   * This is typically an IfcGeometricRepresentationSubContext with ContextIdentifier='Body'
   */
  private findBodyRepresentationContext(): number | null {
    if (!this.dataStore.source) return null;
    const decoder = new TextDecoder();

    for (const [id, entityRef] of this.dataStore.entityIndex.byId) {
      if (entityRef.type.toUpperCase() === 'IFCGEOMETRICREPRESENTATIONSUBCONTEXT') {
        const entityText = decoder.decode(
          this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
        );
        // Look for ContextIdentifier='Body'
        if (entityText.includes("'Body'")) {
          return id;
        }
      }
    }
    return null;
  }

  // =========================================================================
  // Placement Transformation Methods
  // =========================================================================

  /**
   * Get the cumulative placement transformation matrix for an entity
   * This includes the full chain of relative placements
   * Returns a column-major 4x4 matrix as a 16-element array, or null if no placement
   */
  private getEntityPlacementMatrix(entityId: number): number[] | null {
    const entityRef = this.dataStore.entityIndex.byId.get(entityId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // Find ObjectPlacement reference - it's usually the 5th attribute in IfcProduct
    // Pattern: IFCWALL('guid',#owner,'name',$,#placement,#representation,...)
    const refMatches = [...entityText.matchAll(/#(\d+)/g)];

    // For IFC products, placement is typically one of the first few references
    for (const match of refMatches) {
      const refId = parseInt(match[1], 10);
      const refEntity = this.dataStore.entityIndex.byId.get(refId);
      if (refEntity && refEntity.type.toUpperCase() === 'IFCLOCALPLACEMENT') {
        return this.parsePlacementMatrix(refId);
      }
    }
    return null;
  }

  /**
   * Parse IfcLocalPlacement and compute cumulative transformation matrix
   * Handles relative placements by recursively computing parent transforms
   */
  private parsePlacementMatrix(placementId: number): number[] | null {
    const entityRef = this.dataStore.entityIndex.byId.get(placementId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // IfcLocalPlacement(PlacementRelTo, RelativePlacement)
    // PlacementRelTo can be $ (null) or #id of parent placement
    // RelativePlacement is #id of IfcAxis2Placement3D
    const match = entityText.match(/IFCLOCALPLACEMENT\s*\(\s*([^,]+)\s*,\s*#(\d+)/i);
    if (!match) return null;

    const placementRelTo = match[1].trim();
    const axis2PlacementId = parseInt(match[2], 10);

    // Get the local transformation from IfcAxis2Placement3D
    const localMatrix = this.parseAxis2Placement3D(axis2PlacementId);
    if (!localMatrix) return null;

    // If there's a parent placement, multiply matrices
    if (placementRelTo !== '$' && placementRelTo.startsWith('#')) {
      const parentId = parseInt(placementRelTo.substring(1), 10);
      const parentMatrix = this.parsePlacementMatrix(parentId);
      if (parentMatrix) {
        return this.multiplyMatrix4x4(parentMatrix, localMatrix);
      }
    }

    return localMatrix;
  }

  /**
   * Parse IfcAxis2Placement3D and return transformation matrix
   * Returns column-major 4x4 matrix
   */
  private parseAxis2Placement3D(axisPlacementId: number): number[] | null {
    const entityRef = this.dataStore.entityIndex.byId.get(axisPlacementId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // IfcAxis2Placement3D(Location, Axis, RefDirection)
    // Axis is Z direction (can be $), RefDirection is X direction (can be $)
    const match = entityText.match(/IFCAXIS2PLACEMENT3D\s*\(\s*#(\d+)\s*(?:,\s*([^,)]+)\s*)?(?:,\s*([^,)]+)\s*)?\)/i);
    if (!match) return null;

    const locationId = parseInt(match[1], 10);
    const axisArg = match[2]?.trim();
    const refDirArg = match[3]?.trim();

    // Parse location point
    const location = this.parseCartesianPoint(locationId) || { x: 0, y: 0, z: 0 };

    // Parse Z axis (default is [0,0,1])
    let zAxis = { x: 0, y: 0, z: 1 };
    if (axisArg && axisArg.startsWith('#')) {
      const axisId = parseInt(axisArg.substring(1), 10);
      const parsed = this.parseDirection(axisId);
      if (parsed) zAxis = parsed;
    }

    // Parse X axis (RefDirection) - default is [1,0,0]
    let xAxis = { x: 1, y: 0, z: 0 };
    if (refDirArg && refDirArg.startsWith('#')) {
      const refDirId = parseInt(refDirArg.substring(1), 10);
      const parsed = this.parseDirection(refDirId);
      if (parsed) xAxis = parsed;
    }

    // Compute Y axis as cross product of Z and X
    const yAxis = {
      x: zAxis.y * xAxis.z - zAxis.z * xAxis.y,
      y: zAxis.z * xAxis.x - zAxis.x * xAxis.z,
      z: zAxis.x * xAxis.y - zAxis.y * xAxis.x,
    };

    // Build column-major 4x4 transformation matrix
    // [xAxis.x, xAxis.y, xAxis.z, 0,
    //  yAxis.x, yAxis.y, yAxis.z, 0,
    //  zAxis.x, zAxis.y, zAxis.z, 0,
    //  loc.x,   loc.y,   loc.z,   1]
    return [
      xAxis.x, xAxis.y, xAxis.z, 0,
      yAxis.x, yAxis.y, yAxis.z, 0,
      zAxis.x, zAxis.y, zAxis.z, 0,
      location.x, location.y, location.z, 1,
    ];
  }

  /**
   * Parse IfcCartesianPoint
   */
  private parseCartesianPoint(pointId: number): Vec3 | null {
    const entityRef = this.dataStore.entityIndex.byId.get(pointId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // IfcCartesianPoint((x,y,z)) or IfcCartesianPoint((x,y))
    const match = entityText.match(/IFCCARTESIANPOINT\s*\(\s*\(\s*([^)]+)\s*\)\s*\)/i);
    if (!match) return null;

    const coords = match[1].split(',').map(s => parseFloat(s.trim()));
    return {
      x: coords[0] || 0,
      y: coords[1] || 0,
      z: coords[2] || 0,
    };
  }

  /**
   * Parse IfcDirection
   */
  private parseDirection(directionId: number): Vec3 | null {
    const entityRef = this.dataStore.entityIndex.byId.get(directionId);
    if (!entityRef || !this.dataStore.source) return null;

    const decoder = new TextDecoder();
    const entityText = decoder.decode(
      this.dataStore.source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength)
    );

    // IfcDirection((x,y,z)) or IfcDirection((x,y))
    const match = entityText.match(/IFCDIRECTION\s*\(\s*\(\s*([^)]+)\s*\)\s*\)/i);
    if (!match) return null;

    const coords = match[1].split(',').map(s => parseFloat(s.trim()));
    return {
      x: coords[0] || 0,
      y: coords[1] || 0,
      z: coords[2] || 0,
    };
  }

  /**
   * Multiply two 4x4 matrices (column-major)
   */
  private multiplyMatrix4x4(a: number[], b: number[]): number[] {
    const result = new Array(16).fill(0);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + row] * b[col * 4 + k];
        }
        result[col * 4 + row] = sum;
      }
    }
    return result;
  }

  /**
   * Invert a 4x4 transformation matrix (column-major)
   * Uses the fact that for affine transforms, we can separately invert rotation and translation
   */
  private invertMatrix4x4(m: number[]): number[] | null {
    // For a transformation matrix [R | T], the inverse is [R^T | -R^T * T]
    // where R is the 3x3 rotation part and T is the translation

    // Extract rotation (columns 0-2, rows 0-2)
    const r00 = m[0], r10 = m[1], r20 = m[2];
    const r01 = m[4], r11 = m[5], r21 = m[6];
    const r02 = m[8], r12 = m[9], r22 = m[10];

    // Extract translation
    const tx = m[12], ty = m[13], tz = m[14];

    // Transpose of rotation (R^T)
    // For orthonormal matrices (pure rotation), transpose equals inverse

    // Compute -R^T * T
    const invTx = -(r00 * tx + r10 * ty + r20 * tz);
    const invTy = -(r01 * tx + r11 * ty + r21 * tz);
    const invTz = -(r02 * tx + r12 * ty + r22 * tz);

    // Build inverse matrix (column-major)
    return [
      r00, r01, r02, 0,  // Column 0: transposed row 0 of rotation
      r10, r11, r12, 0,  // Column 1: transposed row 1 of rotation
      r20, r21, r22, 0,  // Column 2: transposed row 2 of rotation
      invTx, invTy, invTz, 1,  // Column 3: inverted translation
    ];
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
