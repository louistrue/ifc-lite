/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Columnar parser - builds columnar data structures
 *
 * OPTIMIZED: Single-pass extraction for maximum performance
 * Instead of multiple passes through entities, we extract everything in ONE loop.
 */

import type { EntityRef, IfcEntity, Relationship } from './types.js';
import { SpatialHierarchyBuilder } from './spatial-hierarchy-builder.js';
import { EntityExtractor } from './entity-extractor.js';
import { extractLengthUnitScale } from './unit-extractor.js';
import { getAttributeNames } from './ifc-schema.js';
import { parsePropertyValue } from './on-demand-extractors.js';
import { CompactEntityIndex, buildCompactEntityIndex } from './compact-entity-index.js';
import {
    StringTable,
    EntityTableBuilder,
    PropertyTableBuilder,
    QuantityTableBuilder,
    RelationshipGraphBuilder,
    RelationshipType,
    QuantityType,
    PropertyValueType,
} from '@ifc-lite/data';
import type { SpatialHierarchy, QuantityTable, PropertyValue } from '@ifc-lite/data';

// SpatialIndex interface - matches BVH from @ifc-lite/spatial
export interface SpatialIndex {
    queryAABB(bounds: { min: [number, number, number]; max: [number, number, number] }): number[];
    raycast(origin: [number, number, number], direction: [number, number, number]): number[];
}

/**
 * Entity-by-ID lookup interface. Supports both Map<number, EntityRef> (legacy)
 * and CompactEntityIndex (memory-optimized typed arrays with LRU cache).
 */
export type EntityByIdIndex = {
    get(expressId: number): EntityRef | undefined;
    has(expressId: number): boolean;
    readonly size: number;
    keys(): IterableIterator<number>;
    values(): IterableIterator<EntityRef>;
    entries(): IterableIterator<[number, EntityRef]>;
    forEach(callback: (value: EntityRef, key: number) => void): void;
    [Symbol.iterator](): IterableIterator<[number, EntityRef]>;
};

export interface IfcDataStore {
    fileSize: number;
    schemaVersion: 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'IFC5';
    entityCount: number;
    parseTime: number;

    source: Uint8Array;
    entityIndex: { byId: EntityByIdIndex; byType: Map<string, number[]> };

    strings: StringTable;
    entities: ReturnType<EntityTableBuilder['build']>;
    properties: ReturnType<PropertyTableBuilder['build']>;
    quantities: QuantityTable;
    relationships: ReturnType<RelationshipGraphBuilder['build']>;

    spatialHierarchy?: SpatialHierarchy;
    spatialIndex?: SpatialIndex;

    /**
     * On-demand property lookup: entityId -> array of property set expressIds
     * Used for fast single-entity property access without pre-building property tables.
     * Use extractPropertiesOnDemand() with this map for instant property retrieval.
     */
    onDemandPropertyMap?: Map<number, number[]>;

    /**
     * On-demand quantity lookup: entityId -> array of quantity set expressIds
     * Used for fast single-entity quantity access without pre-building quantity tables.
     * Use extractQuantitiesOnDemand() with this map for instant quantity retrieval.
     */
    onDemandQuantityMap?: Map<number, number[]>;

    /**
     * On-demand classification lookup: entityId -> array of IfcClassificationReference expressIds
     * Built from IfcRelAssociatesClassification relationships during parsing.
     */
    onDemandClassificationMap?: Map<number, number[]>;

    /**
     * On-demand material lookup: entityId -> relatingMaterial expressId
     * Built from IfcRelAssociatesMaterial relationships during parsing.
     * Value is the expressId of IfcMaterial, IfcMaterialLayerSet, IfcMaterialProfileSet, or IfcMaterialConstituentSet.
     */
    onDemandMaterialMap?: Map<number, number>;

    /**
     * On-demand document lookup: entityId -> array of IfcDocumentReference/IfcDocumentInformation expressIds
     * Built from IfcRelAssociatesDocument relationships during parsing.
     */
    onDemandDocumentMap?: Map<number, number[]>;
}

// Pre-computed type sets for O(1) lookups
const GEOMETRY_TYPES = new Set([
    'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCDOOR', 'IFCWINDOW', 'IFCSLAB',
    'IFCCOLUMN', 'IFCBEAM', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
    'IFCRAILING', 'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCPLATE', 'IFCMEMBER',
    'IFCCURTAINWALL', 'IFCFOOTING', 'IFCPILE', 'IFCBUILDINGELEMENTPROXY',
    'IFCFURNISHINGELEMENT', 'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL',
    'IFCFLOWCONTROLLER', 'IFCFLOWFITTING', 'IFCSPACE', 'IFCOPENINGELEMENT',
    'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY',
]);

// IMPORTANT: This set MUST include ALL RelationshipType enum values to prevent semantic loss
// Missing types will be skipped during parsing, causing incomplete relationship graphs
const RELATIONSHIP_TYPES = new Set([
    'IFCRELCONTAINEDINSPATIALSTRUCTURE', 'IFCRELAGGREGATES',
    'IFCRELDEFINESBYPROPERTIES', 'IFCRELDEFINESBYTYPE',
    'IFCRELASSOCIATESMATERIAL', 'IFCRELASSOCIATESCLASSIFICATION',
    'IFCRELASSOCIATESDOCUMENT',
    'IFCRELVOIDSELEMENT', 'IFCRELFILLSELEMENT',
    'IFCRELCONNECTSPATHELEMENTS', 'IFCRELCONNECTSELEMENTS',
    'IFCRELSPACEBOUNDARY',
    'IFCRELASSIGNSTOGROUP', 'IFCRELASSIGNSTOPRODUCT',
    'IFCRELREFERENCEDINSPATIALSTRUCTURE',
]);

// Map IFC relationship type strings to RelationshipType enum
// MUST cover ALL RelationshipType enum values (14 types total)
const REL_TYPE_MAP: Record<string, RelationshipType> = {
    'IFCRELCONTAINEDINSPATIALSTRUCTURE': RelationshipType.ContainsElements,
    'IFCRELAGGREGATES': RelationshipType.Aggregates,
    'IFCRELDEFINESBYPROPERTIES': RelationshipType.DefinesByProperties,
    'IFCRELDEFINESBYTYPE': RelationshipType.DefinesByType,
    'IFCRELASSOCIATESMATERIAL': RelationshipType.AssociatesMaterial,
    'IFCRELASSOCIATESCLASSIFICATION': RelationshipType.AssociatesClassification,
    'IFCRELASSOCIATESDOCUMENT': RelationshipType.AssociatesDocument,
    'IFCRELVOIDSELEMENT': RelationshipType.VoidsElement,
    'IFCRELFILLSELEMENT': RelationshipType.FillsElement,
    'IFCRELCONNECTSPATHELEMENTS': RelationshipType.ConnectsPathElements,
    'IFCRELCONNECTSELEMENTS': RelationshipType.ConnectsElements,
    'IFCRELSPACEBOUNDARY': RelationshipType.SpaceBoundary,
    'IFCRELASSIGNSTOGROUP': RelationshipType.AssignsToGroup,
    'IFCRELASSIGNSTOPRODUCT': RelationshipType.AssignsToProduct,
    'IFCRELREFERENCEDINSPATIALSTRUCTURE': RelationshipType.ReferencedInSpatialStructure,
};

const QUANTITY_TYPE_MAP: Record<string, QuantityType> = {
    'IFCQUANTITYLENGTH': QuantityType.Length,
    'IFCQUANTITYAREA': QuantityType.Area,
    'IFCQUANTITYVOLUME': QuantityType.Volume,
    'IFCQUANTITYCOUNT': QuantityType.Count,
    'IFCQUANTITYWEIGHT': QuantityType.Weight,
    'IFCQUANTITYTIME': QuantityType.Time,
};

// Types needed for spatial hierarchy (small subset)
const SPATIAL_TYPES = new Set([
    'IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE',
]);

// Relationship types needed for hierarchy and structural relationships
const HIERARCHY_REL_TYPES = new Set([
    'IFCRELAGGREGATES', 'IFCRELCONTAINEDINSPATIALSTRUCTURE',
    'IFCRELDEFINESBYTYPE',
    // Structural relationships (voids, fills, connections, groups)
    'IFCRELVOIDSELEMENT', 'IFCRELFILLSELEMENT',
    'IFCRELCONNECTSPATHELEMENTS', 'IFCRELCONNECTSELEMENTS',
    'IFCRELSPACEBOUNDARY',
    'IFCRELASSIGNSTOGROUP', 'IFCRELASSIGNSTOPRODUCT',
    'IFCRELREFERENCEDINSPATIALSTRUCTURE',
]);

// Relationship types for on-demand property loading
const PROPERTY_REL_TYPES = new Set([
    'IFCRELDEFINESBYPROPERTIES',
]);

// Relationship types for on-demand classification/material loading
const ASSOCIATION_REL_TYPES = new Set([
    'IFCRELASSOCIATESCLASSIFICATION', 'IFCRELASSOCIATESMATERIAL',
    'IFCRELASSOCIATESDOCUMENT',
]);

// Attributes to skip in extractAllEntityAttributes (shown elsewhere or non-displayable)
const SKIP_DISPLAY_ATTRS = new Set(['GlobalId', 'OwnerHistory', 'ObjectPlacement', 'Representation', 'HasPropertySets', 'RepresentationMaps']);

// Property-related entity types for on-demand extraction
const PROPERTY_ENTITY_TYPES = new Set([
    'IFCPROPERTYSET', 'IFCELEMENTQUANTITY',
    'IFCPROPERTYSINGLEVALUE', 'IFCPROPERTYENUMERATEDVALUE',
    'IFCPROPERTYBOUNDEDVALUE', 'IFCPROPERTYTABLEVALUE',
    'IFCPROPERTYLISTVALUE', 'IFCPROPERTYREFERENCEVALUE',
    'IFCQUANTITYLENGTH', 'IFCQUANTITYAREA', 'IFCQUANTITYVOLUME',
    'IFCQUANTITYCOUNT', 'IFCQUANTITYWEIGHT', 'IFCQUANTITYTIME',
]);

function isIfcTypeLikeEntity(typeUpper: string): boolean {
    return typeUpper.endsWith('TYPE') || typeUpper.endsWith('STYLE');
}

function detectSchemaVersion(buffer: Uint8Array): IfcDataStore['schemaVersion'] {
    const headerEnd = Math.min(buffer.length, 2000);
    const headerText = new TextDecoder().decode(buffer.subarray(0, headerEnd)).toUpperCase();

    if (headerText.includes('IFC5')) return 'IFC5';
    if (headerText.includes('IFC4X3')) return 'IFC4X3';
    if (headerText.includes('IFC4')) return 'IFC4';
    if (headerText.includes('IFC2X3')) return 'IFC2X3';

    return 'IFC4'; // Default fallback
}

export class ColumnarParser {
    /**
     * Parse IFC file into columnar data store
     *
     * Uses fast semicolon-based scanning with on-demand property extraction.
     * Properties are parsed lazily when accessed, not upfront.
     * This provides instant UI responsiveness even for very large files.
     */
    async parseLite(
        buffer: ArrayBuffer,
        entityRefs: EntityRef[],
        options: {
            onProgress?: (progress: { phase: string; percent: number }) => void;
            onSpatialReady?: (partialStore: IfcDataStore) => void;
        } = {}
    ): Promise<IfcDataStore> {
        const startTime = performance.now();
        const uint8Buffer = new Uint8Array(buffer);
        const totalEntities = entityRefs.length;

        options.onProgress?.({ phase: 'building', percent: 0 });

        // Detect schema version from FILE_SCHEMA header
        const schemaVersion = detectSchemaVersion(uint8Buffer);

        // Initialize builders
        const strings = new StringTable();
        const entityTableBuilder = new EntityTableBuilder(totalEntities, strings);
        const propertyTableBuilder = new PropertyTableBuilder(strings);
        const quantityTableBuilder = new QuantityTableBuilder(strings);
        const relationshipGraphBuilder = new RelationshipGraphBuilder();

        // Build compact entity index (typed arrays instead of Map for ~3x memory reduction)
        const compactByIdIndex = buildCompactEntityIndex(entityRefs);

        // Single pass: build byType index AND categorize entities simultaneously.
        // Uses a type-name cache to avoid calling .toUpperCase() on 4.4M refs
        // (only ~776 unique type names in IFC4).
        const byType = new Map<string, number[]>();

        const RELEVANT_ENTITY_PREFIXES = new Set([
            'IFCWALL', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN', 'IFCPLATE', 'IFCDOOR', 'IFCWINDOW',
            'IFCROOF', 'IFCSTAIR', 'IFCRAILING', 'IFCRAMP', 'IFCFOOTING', 'IFCPILE',
            'IFCMEMBER', 'IFCCURTAINWALL', 'IFCBUILDINGELEMENTPROXY', 'IFCFURNISHINGELEMENT',
            'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL', 'IFCFLOWCONTROLLER', 'IFCFLOWFITTING',
            'IFCSPACE', 'IFCOPENINGELEMENT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY',
            'IFCPROJECT', 'IFCCOVERING', 'IFCANNOTATION', 'IFCGRID',
        ]);

        // Category constants for the lookup cache
        const CAT_SKIP = 0, CAT_SPATIAL = 1, CAT_GEOMETRY = 2, CAT_HIERARCHY_REL = 3,
              CAT_PROPERTY_REL = 4, CAT_PROPERTY_ENTITY = 5, CAT_ASSOCIATION_REL = 6,
              CAT_TYPE_OBJECT = 7, CAT_RELEVANT = 8;

        // Cache: type name → category (avoids 4.4M .toUpperCase() calls)
        const typeCategoryCache = new Map<string, number>();
        function getCategory(type: string): number {
            let cat = typeCategoryCache.get(type);
            if (cat !== undefined) return cat;
            const upper = type.toUpperCase();
            if (SPATIAL_TYPES.has(upper)) cat = CAT_SPATIAL;
            else if (GEOMETRY_TYPES.has(upper)) cat = CAT_GEOMETRY;
            else if (HIERARCHY_REL_TYPES.has(upper)) cat = CAT_HIERARCHY_REL;
            else if (PROPERTY_REL_TYPES.has(upper)) cat = CAT_PROPERTY_REL;
            else if (PROPERTY_ENTITY_TYPES.has(upper)) cat = CAT_PROPERTY_ENTITY;
            else if (ASSOCIATION_REL_TYPES.has(upper)) cat = CAT_ASSOCIATION_REL;
            else if (isIfcTypeLikeEntity(upper)) cat = CAT_TYPE_OBJECT;
            else if (RELEVANT_ENTITY_PREFIXES.has(upper) || upper.startsWith('IFCREL')) cat = CAT_RELEVANT;
            else cat = CAT_SKIP;
            typeCategoryCache.set(type, cat);
            return cat;
        }

        const spatialRefs: EntityRef[] = [];
        const geometryRefs: EntityRef[] = [];
        const relationshipRefs: EntityRef[] = [];
        const propertyRelRefs: EntityRef[] = [];
        const propertyEntityRefs: EntityRef[] = [];
        const associationRelRefs: EntityRef[] = [];
        const typeObjectRefs: EntityRef[] = [];
        const otherRelevantRefs: EntityRef[] = [];

        for (const ref of entityRefs) {
            // Build byType index
            let typeList = byType.get(ref.type);
            if (!typeList) { typeList = []; byType.set(ref.type, typeList); }
            typeList.push(ref.expressId);

            // Categorize (cached — .toUpperCase() called once per unique type)
            const cat = getCategory(ref.type);
            if (cat === CAT_SPATIAL) spatialRefs.push(ref);
            else if (cat === CAT_GEOMETRY) geometryRefs.push(ref);
            else if (cat === CAT_HIERARCHY_REL) relationshipRefs.push(ref);
            else if (cat === CAT_PROPERTY_REL) propertyRelRefs.push(ref);
            else if (cat === CAT_PROPERTY_ENTITY) propertyEntityRefs.push(ref);
            else if (cat === CAT_ASSOCIATION_REL) associationRelRefs.push(ref);
            else if (cat === CAT_TYPE_OBJECT) typeObjectRefs.push(ref);
            else if (cat === CAT_RELEVANT) otherRelevantRefs.push(ref);
        }

        const entityIndex = {
            byId: compactByIdIndex as EntityByIdIndex,
            byType,
        };

        // Yield to main thread between heavy phases so geometry streaming callbacks
        // can fire. Only ~5-6 yields total ≈ 5ms overhead (vs 110K+ per-iteration yields).
        const yieldToGeometry = () => new Promise<void>(resolve => setTimeout(resolve, 0));

        await yieldToGeometry(); // Let geometry process after categorization

        // === TARGETED PARSING: Parse spatial and geometry entities for GlobalIds ===
        options.onProgress?.({ phase: 'parsing spatial', percent: 10 });

        const extractor = new EntityExtractor(uint8Buffer);
        const parsedEntityData = new Map<number, { globalId: string; name: string }>();

        // Parse spatial entities (typically < 100 entities)
        for (const ref of spatialRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
                const name = typeof attrs[2] === 'string' ? attrs[2] : '';
                parsedEntityData.set(ref.expressId, { globalId, name });
            }
        }

        // Parse geometry entities for GlobalIds (needed for BCF component references)
        options.onProgress?.({ phase: 'parsing geometry globalIds', percent: 12 });
        for (const ref of geometryRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
                const name = typeof attrs[2] === 'string' ? attrs[2] : '';
                parsedEntityData.set(ref.expressId, { globalId, name });
            }
        }

        await yieldToGeometry(); // Let geometry process after heavy geometry parsing

        // Parse type objects (IfcWallType, IfcDoorType, etc.) for GlobalId and Name
        for (const ref of typeObjectRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
                const name = typeof attrs[2] === 'string' ? attrs[2] : '';
                parsedEntityData.set(ref.expressId, { globalId, name });
            }
        }

        // Parse relationship entities (typically < 10k entities)
        // CRITICAL: relationships are needed for spatial hierarchy, parse early
        options.onProgress?.({ phase: 'parsing relationships', percent: 20 });

        const relationships: Relationship[] = [];
        for (const ref of relationshipRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const typeUpper = entity.type.toUpperCase();
                const rel = this.extractRelationshipFast(entity, typeUpper);
                if (rel) {
                    relationships.push(rel);
                    const relType = REL_TYPE_MAP[typeUpper];
                    if (relType) {
                        for (const targetId of rel.relatedObjects) {
                            relationshipGraphBuilder.addEdge(rel.relatingObject, targetId, relType, rel.relatingObject);
                        }
                    }
                }
            }
        }

        // === BUILD ENTITY TABLE from categorized arrays ===
        // Instead of iterating ALL 4.4M entityRefs, iterate only categorized arrays
        // (~100K-200K total). This eliminates a 200-300ms loop over 4.4M items.
        options.onProgress?.({ phase: 'building entities', percent: 30 });

        // Helper to add entities with pre-parsed data
        const addEntityBatch = (refs: EntityRef[], hasGeometry: boolean, isType: boolean) => {
            for (const ref of refs) {
                const entityData = parsedEntityData.get(ref.expressId);
                entityTableBuilder.add(
                    ref.expressId,
                    ref.type,
                    entityData?.globalId || '',
                    entityData?.name || '',
                    '', // description
                    '', // objectType
                    hasGeometry,
                    isType
                );
            }
        };

        addEntityBatch(spatialRefs, false, false);
        addEntityBatch(geometryRefs, true, false);
        addEntityBatch(typeObjectRefs, false, true);
        addEntityBatch(relationshipRefs, false, false);
        addEntityBatch(otherRelevantRefs, false, false);

        const entityTable = entityTableBuilder.build();

        // Empty property/quantity tables - use on-demand extraction instead
        const propertyTable = propertyTableBuilder.build();
        const quantityTable = quantityTableBuilder.build();

        // Build intermediate relationship graph (spatial/hierarchy edges only).
        // Property/association edges are added later; final graph is rebuilt at the end.
        const hierarchyRelGraph = relationshipGraphBuilder.build();

        await yieldToGeometry(); // Let geometry process before hierarchy build

        // === EXTRACT LENGTH UNIT SCALE ===
        options.onProgress?.({ phase: 'extracting units', percent: 85 });
        const lengthUnitScale = extractLengthUnitScale(uint8Buffer, entityIndex);

        // === BUILD SPATIAL HIERARCHY ===
        options.onProgress?.({ phase: 'building hierarchy', percent: 90 });

        let spatialHierarchy: SpatialHierarchy | undefined;
        try {
            const hierarchyBuilder = new SpatialHierarchyBuilder();
            spatialHierarchy = hierarchyBuilder.build(
                entityTable,
                hierarchyRelGraph,
                strings,
                uint8Buffer,
                entityIndex,
                lengthUnitScale
            );
        } catch (error) {
            console.warn('[ColumnarParser] Failed to build spatial hierarchy:', error);
        }

        // === EMIT SPATIAL HIERARCHY EARLY ===
        // The hierarchy panel can render immediately while property/association
        // parsing continues. This lets the panel appear at the same time as
        // geometry streaming completes.
        const earlyStore: IfcDataStore = {
            fileSize: buffer.byteLength,
            schemaVersion,
            entityCount: totalEntities,
            parseTime: performance.now() - startTime,
            source: uint8Buffer,
            entityIndex,
            strings,
            entities: entityTable,
            properties: propertyTable,
            quantities: quantityTable,
            relationships: hierarchyRelGraph,
            spatialHierarchy,
        };
        options.onSpatialReady?.(earlyStore);

        await yieldToGeometry(); // Let geometry process after hierarchy emission

        // === DEFERRED: Parse property and association relationships ===
        // These are NOT needed for the spatial hierarchy panel.
        // Parsing ~60K entities here adds ~0.5-1s that no longer blocks the panel.
        options.onProgress?.({ phase: 'parsing property refs', percent: 92 });

        const onDemandPropertyMap = new Map<number, number[]>();
        const onDemandQuantityMap = new Map<number, number[]>();

        for (const ref of propertyRelRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const relatedObjects = attrs[4];
                const relatingDef = attrs[5];

                if (typeof relatingDef === 'number' && Array.isArray(relatedObjects)) {
                    for (const objId of relatedObjects) {
                        if (typeof objId === 'number') {
                            relationshipGraphBuilder.addEdge(relatingDef, objId, RelationshipType.DefinesByProperties, ref.expressId);
                        }
                    }

                    const defRef = entityIndex.byId.get(relatingDef);
                    if (defRef) {
                        const defTypeUpper = defRef.type.toUpperCase();
                        const isPropertySet = defTypeUpper === 'IFCPROPERTYSET';
                        const isQuantitySet = defTypeUpper === 'IFCELEMENTQUANTITY';

                        if (isPropertySet || isQuantitySet) {
                            const targetMap = isPropertySet ? onDemandPropertyMap : onDemandQuantityMap;
                            for (const objId of relatedObjects) {
                                if (typeof objId === 'number') {
                                    let list = targetMap.get(objId);
                                    if (!list) {
                                        list = [];
                                        targetMap.set(objId, list);
                                    }
                                    list.push(relatingDef);
                                }
                            }
                        }
                    }
                }
            }
        }

        await yieldToGeometry(); // Let geometry process after property parsing

        // === DEFERRED: Parse association relationships ===
        options.onProgress?.({ phase: 'parsing associations', percent: 95 });

        const onDemandClassificationMap = new Map<number, number[]>();
        const onDemandMaterialMap = new Map<number, number>();
        const onDemandDocumentMap = new Map<number, number[]>();

        for (const ref of associationRelRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                const relatedObjects = attrs[4];
                const relatingRef = attrs[5];

                if (typeof relatingRef === 'number' && Array.isArray(relatedObjects)) {
                    const typeUpper = ref.type.toUpperCase();

                    if (typeUpper === 'IFCRELASSOCIATESCLASSIFICATION') {
                        for (const objId of relatedObjects) {
                            if (typeof objId === 'number') {
                                let list = onDemandClassificationMap.get(objId);
                                if (!list) {
                                    list = [];
                                    onDemandClassificationMap.set(objId, list);
                                }
                                list.push(relatingRef);
                            }
                        }
                    } else if (typeUpper === 'IFCRELASSOCIATESMATERIAL') {
                        for (const objId of relatedObjects) {
                            if (typeof objId === 'number') {
                                onDemandMaterialMap.set(objId, relatingRef);
                            }
                        }
                    } else if (typeUpper === 'IFCRELASSOCIATESDOCUMENT') {
                        for (const objId of relatedObjects) {
                            if (typeof objId === 'number') {
                                let list = onDemandDocumentMap.get(objId);
                                if (!list) {
                                    list = [];
                                    onDemandDocumentMap.set(objId, list);
                                }
                                list.push(relatingRef);
                            }
                        }
                    }
                }
            }
        }

        // Rebuild relationship graph with ALL edges (hierarchy + property + association)
        const fullRelationshipGraph = relationshipGraphBuilder.build();

        const parseTime = performance.now() - startTime;
        options.onProgress?.({ phase: 'complete', percent: 100 });

        return {
            ...earlyStore,
            parseTime,
            relationships: fullRelationshipGraph,
            onDemandPropertyMap,
            onDemandQuantityMap,
            onDemandClassificationMap,
            onDemandMaterialMap,
            onDemandDocumentMap,
        };
    }

    /**
     * Fast relationship extraction - inline for performance
     */
    private extractRelationshipFast(entity: IfcEntity, typeUpper: string): Relationship | null {
        const attrs = entity.attributes;
        if (attrs.length < 6) return null;

        let relatingObject: unknown;
        let relatedObjects: unknown;

        if (typeUpper === 'IFCRELDEFINESBYPROPERTIES' || typeUpper === 'IFCRELDEFINESBYTYPE'
            || typeUpper === 'IFCRELCONTAINEDINSPATIALSTRUCTURE' || typeUpper === 'IFCRELREFERENCEDINSPATIALSTRUCTURE') {
            relatedObjects = attrs[4];
            relatingObject = attrs[5];
        } else if (typeUpper === 'IFCRELASSIGNSTOGROUP' || typeUpper === 'IFCRELASSIGNSTOPRODUCT') {
            relatedObjects = attrs[4];
            relatingObject = attrs.length > 6 ? attrs[6] : undefined;
        } else if (typeUpper === 'IFCRELCONNECTSELEMENTS' || typeUpper === 'IFCRELCONNECTSPATHELEMENTS') {
            relatingObject = attrs[5];
            relatedObjects = attrs.length > 6 ? attrs[6] : undefined;
        } else {
            relatingObject = attrs[4];
            relatedObjects = attrs[5];
        }

        if (typeof relatingObject !== 'number') return null;

        let relatedArray: number[];
        if (Array.isArray(relatedObjects)) {
            relatedArray = relatedObjects.filter((id): id is number => typeof id === 'number');
        } else if (typeof relatedObjects === 'number') {
            relatedArray = [relatedObjects];
        } else {
            return null;
        }

        return { type: entity.type, relatingObject, relatedObjects: relatedArray };
    }

    /**
     * Extract properties for a single entity ON-DEMAND
     * Parses only what's needed from the source buffer - instant results.
     */
    extractPropertiesOnDemand(
        store: IfcDataStore,
        entityId: number
    ): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> {
        // Use on-demand extraction if map is available (preferred for single-entity access)
        if (!store.onDemandPropertyMap) {
            // Fallback to pre-computed property table (e.g., server-parsed data)
            return store.properties.getForEntity(entityId);
        }

        const psetIds = store.onDemandPropertyMap.get(entityId);
        if (!psetIds || psetIds.length === 0) {
            return [];
        }

        const extractor = new EntityExtractor(store.source);
        const result: Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> = [];

        for (const psetId of psetIds) {
            const psetRef = store.entityIndex.byId.get(psetId);
            if (!psetRef) continue;

            const psetEntity = extractor.extractEntity(psetRef);
            if (!psetEntity) continue;

            const psetAttrs = psetEntity.attributes || [];
            const psetGlobalId = typeof psetAttrs[0] === 'string' ? psetAttrs[0] : undefined;
            const psetName = typeof psetAttrs[2] === 'string' ? psetAttrs[2] : `PropertySet #${psetId}`;
            const hasProperties = psetAttrs[4];

            const properties: Array<{ name: string; type: number; value: PropertyValue }> = [];

            if (Array.isArray(hasProperties)) {
                for (const propRef of hasProperties) {
                    if (typeof propRef !== 'number') continue;

                    const propEntityRef = store.entityIndex.byId.get(propRef);
                    if (!propEntityRef) continue;

                    const propEntity = extractor.extractEntity(propEntityRef);
                    if (!propEntity) continue;

                    const propAttrs = propEntity.attributes || [];
                    const propName = typeof propAttrs[0] === 'string' ? propAttrs[0] : '';
                    if (!propName) continue;

                    const parsed = parsePropertyValue(propEntity);
                    properties.push({ name: propName, type: parsed.type, value: parsed.value });
                }
            }

            if (properties.length > 0 || psetName) {
                result.push({ name: psetName, globalId: psetGlobalId, properties });
            }
        }

        return result;
    }

    /**
     * Extract quantities for a single entity ON-DEMAND
     * Parses only what's needed from the source buffer - instant results.
     */
    extractQuantitiesOnDemand(
        store: IfcDataStore,
        entityId: number
    ): Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> {
        // Use on-demand extraction if map is available (preferred for single-entity access)
        if (!store.onDemandQuantityMap) {
            // Fallback to pre-computed quantity table (e.g., server-parsed data)
            return store.quantities.getForEntity(entityId);
        }

        const qsetIds = store.onDemandQuantityMap.get(entityId);
        if (!qsetIds || qsetIds.length === 0) {
            return [];
        }

        const extractor = new EntityExtractor(store.source);
        const result: Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> = [];

        for (const qsetId of qsetIds) {
            const qsetRef = store.entityIndex.byId.get(qsetId);
            if (!qsetRef) continue;

            const qsetEntity = extractor.extractEntity(qsetRef);
            if (!qsetEntity) continue;

            const qsetAttrs = qsetEntity.attributes || [];
            const qsetName = typeof qsetAttrs[2] === 'string' ? qsetAttrs[2] : `QuantitySet #${qsetId}`;
            const hasQuantities = qsetAttrs[5];

            const quantities: Array<{ name: string; type: number; value: number }> = [];

            if (Array.isArray(hasQuantities)) {
                for (const qtyRef of hasQuantities) {
                    if (typeof qtyRef !== 'number') continue;

                    const qtyEntityRef = store.entityIndex.byId.get(qtyRef);
                    if (!qtyEntityRef) continue;

                    const qtyEntity = extractor.extractEntity(qtyEntityRef);
                    if (!qtyEntity) continue;

                    const qtyAttrs = qtyEntity.attributes || [];
                    const qtyName = typeof qtyAttrs[0] === 'string' ? qtyAttrs[0] : '';
                    if (!qtyName) continue;

                    // Get quantity type from entity type
                    const qtyTypeUpper = qtyEntity.type.toUpperCase();
                    const qtyType = QUANTITY_TYPE_MAP[qtyTypeUpper] ?? QuantityType.Count;

                    // Value is at index 3 for most quantity types
                    const value = typeof qtyAttrs[3] === 'number' ? qtyAttrs[3] : 0;

                    quantities.push({ name: qtyName, type: qtyType, value });
                }
            }

            if (quantities.length > 0 || qsetName) {
                result.push({ name: qsetName, quantities });
            }
        }

        return result;
    }
}

/**
 * Standalone on-demand property extractor
 * Can be used outside ColumnarParser class
 */
export function extractPropertiesOnDemand(
    store: IfcDataStore,
    entityId: number
): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: PropertyValue }> }> {
    const parser = new ColumnarParser();
    return parser.extractPropertiesOnDemand(store, entityId);
}

/**
 * Standalone on-demand quantity extractor
 * Can be used outside ColumnarParser class
 */
export function extractQuantitiesOnDemand(
    store: IfcDataStore,
    entityId: number
): Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> {
    const parser = new ColumnarParser();
    return parser.extractQuantitiesOnDemand(store, entityId);
}

/**
 * Extract entity attributes on-demand from source buffer
 * Returns globalId, name, description, objectType, tag for any IfcRoot-derived entity.
 * This is used for entities that weren't fully parsed during initial load.
 */
export function extractEntityAttributesOnDemand(
    store: IfcDataStore,
    entityId: number
): { globalId: string; name: string; description: string; objectType: string; tag: string } {
    const ref = store.entityIndex.byId.get(entityId);
    if (!ref) {
        return { globalId: '', name: '', description: '', objectType: '', tag: '' };
    }

    const extractor = new EntityExtractor(store.source);
    const entity = extractor.extractEntity(ref);
    if (!entity) {
        return { globalId: '', name: '', description: '', objectType: '', tag: '' };
    }

    const attrs = entity.attributes || [];
    // IfcRoot attributes: [GlobalId, OwnerHistory, Name, Description]
    // IfcObject adds: [ObjectType] at index 4
    // IfcProduct adds: [ObjectPlacement, Representation] at indices 5-6
    // IfcElement adds: [Tag] at index 7
    const globalId = typeof attrs[0] === 'string' ? attrs[0] : '';
    const name = typeof attrs[2] === 'string' ? attrs[2] : '';
    const description = typeof attrs[3] === 'string' ? attrs[3] : '';
    const objectType = typeof attrs[4] === 'string' ? attrs[4] : '';
    const tag = typeof attrs[7] === 'string' ? attrs[7] : '';

    return { globalId, name, description, objectType, tag };
}

/**
 * Extract ALL named entity attributes on-demand from source buffer.
 * Uses the IFC schema to map attribute indices to names.
 * Returns only string/enum attributes, skipping references and structural attributes.
 */
export function extractAllEntityAttributes(
    store: IfcDataStore,
    entityId: number
): Array<{ name: string; value: string }> {
    const ref = store.entityIndex.byId.get(entityId);
    if (!ref) return [];

    const extractor = new EntityExtractor(store.source);
    const entity = extractor.extractEntity(ref);
    if (!entity) return [];

    const attrs = entity.attributes || [];
    // Use properly-cased type name from entity table (IfcTypeEnumToString)
    // instead of ref.type which is UPPERCASE from STEP (e.g., IFCWALLSTANDARDCASE)
    // and breaks multi-word type normalization in getAttributeNames
    const typeName = store.entities.getTypeName(entityId);
    const attrNames = getAttributeNames(typeName || ref.type);

    const result: Array<{ name: string; value: string }> = [];
    const len = Math.min(attrs.length, attrNames.length);
    for (let i = 0; i < len; i++) {
        const attrName = attrNames[i];
        if (SKIP_DISPLAY_ATTRS.has(attrName)) continue;

        const raw = attrs[i];
        if (typeof raw === 'string' && raw) {
            // Clean enum values: .NOTDEFINED. -> NOTDEFINED
            const display = raw.startsWith('.') && raw.endsWith('.')
                ? raw.slice(1, -1)
                : raw;
            result.push({ name: attrName, value: display });
        }
    }

    return result;
}

// Re-export on-demand extraction functions from focused module
export {
    extractClassificationsOnDemand,
    extractMaterialsOnDemand,
    extractTypePropertiesOnDemand,
    extractTypeEntityOwnProperties,
    extractDocumentsOnDemand,
    extractRelationshipsOnDemand,
    extractGeoreferencingOnDemand,
    parsePropertyValue,
    extractPsetsFromIds,
} from './on-demand-extractors.js';

export type {
    ClassificationInfo,
    MaterialInfo,
    MaterialLayerInfo,
    MaterialProfileInfo,
    MaterialConstituentInfo,
    TypePropertyInfo,
    DocumentInfo,
    EntityRelationships,
    GeorefInfo,
} from './on-demand-extractors.js';
