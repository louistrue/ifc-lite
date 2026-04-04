/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Columnar parser - builds columnar data structures
 *
 * OPTIMIZED: Single-pass extraction for maximum performance
 * Instead of multiple passes through entities, we extract everything in ONE loop.
 */

import type { EntityRef } from './types.js';
import { SpatialHierarchyBuilder } from './spatial-hierarchy-builder.js';
import { EntityExtractor } from './entity-extractor.js';
import { extractLengthUnitScale } from './unit-extractor.js';
import { decodeIfcString } from '@ifc-lite/encoding';
import { getAttributeNames, getInheritanceChain } from './ifc-schema.js';
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
    'IFCFACILITY', 'IFCFACILITYPART',
    'IFCBRIDGE', 'IFCBRIDGEPART',
    'IFCROAD', 'IFCROADPART',
    'IFCRAILWAY', 'IFCRAILWAYPART',
    'IFCMARINEFACILITY',
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

// ==========================================
// Byte-level helpers for fast extraction
// These avoid per-entity TextDecoder calls by working on raw bytes.
// ==========================================

/**
 * Find the byte range of a quoted string at a specific attribute position in STEP entity bytes.
 * Returns [start, end) byte offsets (excluding quotes), or null if not found.
 *
 * @param buffer - The IFC file buffer
 * @param entityStart - byte offset of the entity
 * @param entityLen - byte length of the entity
 * @param attrIndex - 0-based attribute index (0=GlobalId, 2=Name)
 */
function findQuotedAttrRange(
    buffer: Uint8Array,
    entityStart: number,
    entityLen: number,
    attrIndex: number,
): [number, number] | null {
    const end = entityStart + entityLen;
    let pos = entityStart;

    // Skip to opening paren '(' after TYPE name
    while (pos < end && buffer[pos] !== 0x28 /* ( */) pos++;
    if (pos >= end) return null;
    pos++; // skip '('

    // Skip commas to reach the target attribute
    if (attrIndex > 0) {
        let toSkip = attrIndex;
        let depth = 0;
        let inStr = false;
        while (pos < end && toSkip > 0) {
            const ch = buffer[pos];
            if (ch === 0x27 /* ' */) {
                if (inStr && pos + 1 < end && buffer[pos + 1] === 0x27) {
                    pos += 2; continue;
                }
                inStr = !inStr;
            } else if (!inStr) {
                if (ch === 0x28) depth++;
                else if (ch === 0x29) depth--;
                else if (ch === 0x2C && depth === 0) toSkip--;
            }
            pos++;
        }
    }

    // Skip whitespace
    while (pos < end && (buffer[pos] === 0x20 || buffer[pos] === 0x09)) pos++;

    // Check for quoted string
    if (pos >= end || buffer[pos] !== 0x27 /* ' */) return null;
    pos++; // skip opening quote
    const start = pos;

    // Find closing quote (handle escaped quotes '')
    while (pos < end) {
        if (buffer[pos] === 0x27) {
            if (pos + 1 < end && buffer[pos + 1] === 0x27) {
                pos += 2; continue;
            }
            break;
        }
        pos++;
    }
    return [start, pos];
}

/**
 * Batch extract GlobalId (attr[0]) and Name (attr[2]) for many entities using
 * only 2 TextDecoder.decode() calls total (one for all GlobalIds, one for all Names).
 *
 * This is ~100x faster than calling extractEntity() per entity for large batches
 * because it eliminates per-entity TextDecoder overhead which is significant in Firefox.
 *
 * Returns a Map from expressId → { globalId, name }.
 */
function batchExtractGlobalIdAndName(
    buffer: Uint8Array,
    refs: EntityRef[],
): Map<number, { globalId: string; name: string }> {
    const result = new Map<number, { globalId: string; name: string }>();
    if (refs.length === 0) return result;

    // Phase 1: Scan byte ranges for GlobalId and Name positions (no string allocation)
    const gidRanges: Array<[number, number]> = []; // [start, end) for each entity
    const nameRanges: Array<[number, number]> = [];
    const validIndices: number[] = []; // indices into refs for entities with valid ranges

    for (let i = 0; i < refs.length; i++) {
        const ref = refs[i];
        const gidRange = findQuotedAttrRange(buffer, ref.byteOffset, ref.byteLength, 0);
        const nameRange = findQuotedAttrRange(buffer, ref.byteOffset, ref.byteLength, 2);

        gidRanges.push(gidRange ?? [0, 0]);
        nameRanges.push(nameRange ?? [0, 0]);
        validIndices.push(i);
    }

    // Phase 2: Concatenate all GlobalId bytes into one buffer, decode once
    // Use null byte (0x00) as separator (never appears in IFC string content)
    let totalGidBytes = 0;
    let totalNameBytes = 0;
    for (let i = 0; i < validIndices.length; i++) {
        const [gs, ge] = gidRanges[i];
        const [ns, ne] = nameRanges[i];
        totalGidBytes += (ge - gs) + 1; // +1 for separator
        totalNameBytes += (ne - ns) + 1;
    }

    const gidBuf = new Uint8Array(totalGidBytes);
    const nameBuf = new Uint8Array(totalNameBytes);
    let gidOffset = 0;
    let nameOffset = 0;

    for (let i = 0; i < validIndices.length; i++) {
        const [gs, ge] = gidRanges[i];
        const [ns, ne] = nameRanges[i];

        if (ge > gs) {
            gidBuf.set(buffer.subarray(gs, ge), gidOffset);
            gidOffset += ge - gs;
        }
        gidBuf[gidOffset++] = 0; // null separator

        if (ne > ns) {
            nameBuf.set(buffer.subarray(ns, ne), nameOffset);
            nameOffset += ne - ns;
        }
        nameBuf[nameOffset++] = 0;
    }

    // Phase 3: Two TextDecoder calls for ALL entities
    const decoder = new TextDecoder();
    const allGids = decoder.decode(gidBuf.subarray(0, gidOffset));
    const allNames = decoder.decode(nameBuf.subarray(0, nameOffset));
    const gids = allGids.split('\0');
    const names = allNames.split('\0');

    // Phase 4: Build result map
    for (let i = 0; i < validIndices.length; i++) {
        const ref = refs[validIndices[i]];
        const rawName = names[i] || '';
        result.set(ref.expressId, {
            globalId: gids[i] || '',
            name: rawName ? decodeIfcString(rawName) : '',
        });
    }

    return result;
}

// ==========================================
// Byte-level relationship scanners (numbers only, no TextDecoder)
// ==========================================

/**
 * Skip N commas at depth 0 in STEP bytes.
 */
function skipCommas(buffer: Uint8Array, start: number, end: number, count: number): number {
    let pos = start;
    let remaining = count;
    let depth = 0;
    let inString = false;
    while (pos < end && remaining > 0) {
        const ch = buffer[pos];
        if (ch === 0x27) {
            if (inString && pos + 1 < end && buffer[pos + 1] === 0x27) { pos += 2; continue; }
            inString = !inString;
        } else if (!inString) {
            if (ch === 0x28) depth++;
            else if (ch === 0x29) depth--;
            else if (ch === 0x2C && depth === 0) remaining--;
        }
        pos++;
    }
    return pos;
}

/** Read a #ID entity reference as a number. Returns -1 if not an entity ref. */
function readRefId(buffer: Uint8Array, pos: number, end: number): [number, number] {
    while (pos < end && (buffer[pos] === 0x20 || buffer[pos] === 0x09)) pos++;
    if (pos < end && buffer[pos] === 0x23) {
        pos++;
        let num = 0;
        while (pos < end && buffer[pos] >= 0x30 && buffer[pos] <= 0x39) {
            num = num * 10 + (buffer[pos] - 0x30);
            pos++;
        }
        return [num, pos];
    }
    return [-1, pos];
}

/** Read a list of entity refs (#id1,#id2,...) or a single #id. Returns [ids, newPos]. */
function readRefList(buffer: Uint8Array, pos: number, end: number): [number[], number] {
    while (pos < end && (buffer[pos] === 0x20 || buffer[pos] === 0x09)) pos++;
    const ids: number[] = [];

    if (pos < end && buffer[pos] === 0x28) {
        pos++;
        while (pos < end && buffer[pos] !== 0x29) {
            while (pos < end && (buffer[pos] === 0x20 || buffer[pos] === 0x09 || buffer[pos] === 0x2C)) pos++;
            if (pos < end && buffer[pos] === 0x23) {
                const [id, np] = readRefId(buffer, pos, end);
                if (id >= 0) ids.push(id);
                pos = np;
            } else if (pos < end && buffer[pos] !== 0x29) {
                pos++;
            }
        }
    } else if (pos < end && buffer[pos] === 0x23) {
        const [id, np] = readRefId(buffer, pos, end);
        if (id >= 0) ids.push(id);
        pos = np;
    }
    return [ids, pos];
}

/**
 * Extract relatingObject and relatedObjects from a relationship entity using byte-level scanning.
 * No TextDecoder needed - only extracts numeric entity IDs.
 */
function extractRelFast(
    buffer: Uint8Array,
    byteOffset: number,
    byteLength: number,
    typeUpper: string,
): { relatingObject: number; relatedObjects: number[] } | null {
    const end = byteOffset + byteLength;
    let pos = byteOffset;

    while (pos < end && buffer[pos] !== 0x28) pos++;
    if (pos >= end) return null;
    pos++;

    // Skip to attr[4] (all IfcRelationship subtypes have 4 shared IfcRoot+IfcRelationship attrs)
    pos = skipCommas(buffer, pos, end, 4);

    if (typeUpper === 'IFCRELCONTAINEDINSPATIALSTRUCTURE'
        || typeUpper === 'IFCRELREFERENCEDINSPATIALSTRUCTURE'
        || typeUpper === 'IFCRELDEFINESBYPROPERTIES'
        || typeUpper === 'IFCRELDEFINESBYTYPE') {
        // attr[4]=RelatedObjects, attr[5]=RelatingObject
        const [related, rp] = readRefList(buffer, pos, end);
        pos = rp;
        while (pos < end && buffer[pos] !== 0x2C) pos++;
        pos++;
        const [relating, _] = readRefId(buffer, pos, end);
        if (relating < 0 || related.length === 0) return null;
        return { relatingObject: relating, relatedObjects: related };
    } else if (typeUpper === 'IFCRELASSIGNSTOGROUP' || typeUpper === 'IFCRELASSIGNSTOPRODUCT') {
        const [related, rp] = readRefList(buffer, pos, end);
        pos = skipCommas(buffer, rp, end, 2);
        const [relating, _] = readRefId(buffer, pos, end);
        if (relating < 0 || related.length === 0) return null;
        return { relatingObject: relating, relatedObjects: related };
    } else if (typeUpper === 'IFCRELCONNECTSELEMENTS' || typeUpper === 'IFCRELCONNECTSPATHELEMENTS') {
        pos = skipCommas(buffer, pos, end, 1);
        const [relating, rp2] = readRefId(buffer, pos, end);
        pos = skipCommas(buffer, rp2, end, 1);
        const [related, _] = readRefId(buffer, pos, end);
        if (relating < 0 || related < 0) return null;
        return { relatingObject: relating, relatedObjects: [related] };
    } else {
        // Default: attr[4]=RelatingObject, attr[5]=RelatedObject(s)
        const [relating, rp] = readRefId(buffer, pos, end);
        if (relating < 0) return null;
        pos = rp;
        while (pos < end && buffer[pos] !== 0x2C) pos++;
        pos++;
        const [related, _] = readRefList(buffer, pos, end);
        if (related.length === 0) return null;
        return { relatingObject: relating, relatedObjects: related };
    }
}

/**
 * Extract property rel data: attr[4]=relatedObjects, attr[5]=relatingDef.
 * Numbers only, no TextDecoder.
 */
function extractPropertyRelFast(
    buffer: Uint8Array,
    byteOffset: number,
    byteLength: number,
): { relatedObjects: number[]; relatingDef: number } | null {
    const end = byteOffset + byteLength;
    let pos = byteOffset;

    while (pos < end && buffer[pos] !== 0x28) pos++;
    if (pos >= end) return null;
    pos++;

    pos = skipCommas(buffer, pos, end, 4);

    const [relatedObjects, rp] = readRefList(buffer, pos, end);
    pos = rp;
    while (pos < end && buffer[pos] !== 0x2C) pos++;
    pos++;

    const [relatingDef, _] = readRefId(buffer, pos, end);
    if (relatingDef < 0 || relatedObjects.length === 0) return null;
    return { relatedObjects, relatingDef };
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

        // Phase timing placeholder (telemetry removed for production)
        const logPhase = (_name: string) => {};

        options.onProgress?.({ phase: 'building', percent: 0 });

        // Detect schema version from FILE_SCHEMA header
        const schemaVersion = detectSchemaVersion(uint8Buffer);

        // Initialize builders (entity table capacity set after categorization below)
        const strings = new StringTable();
        const propertyTableBuilder = new PropertyTableBuilder(strings);
        const quantityTableBuilder = new QuantityTableBuilder(strings);
        const relationshipGraphBuilder = new RelationshipGraphBuilder();

        logPhase('init builders');

        // Build compact entity index (typed arrays instead of Map for ~3x memory reduction)
        const compactByIdIndex = buildCompactEntityIndex(entityRefs);
        logPhase('compact entity index');

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


        /** Returns true if `upper` (already uppercased) is a subtype of any type in `set`. */
        function isSubtypeOfAny(upper: string, set: Set<string>): boolean {
            const chain = getInheritanceChain(upper);
            return chain.some(ancestor => set.has(ancestor.toUpperCase()));
        }

        // Cache: type name → category (avoids 4.4M .toUpperCase() calls)
        const typeCategoryCache = new Map<string, number>();
        function getCategory(type: string): number {
            let cat = typeCategoryCache.get(type);
            if (cat !== undefined) return cat;
            const upper = type.toUpperCase();
            if (SPATIAL_TYPES.has(upper) || isSubtypeOfAny(upper, SPATIAL_TYPES)) cat = CAT_SPATIAL;
            else if (GEOMETRY_TYPES.has(upper) || isSubtypeOfAny(upper, GEOMETRY_TYPES)) cat = CAT_GEOMETRY;        
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

        logPhase(`categorize ${totalEntities} → spatial:${spatialRefs.length} geom:${geometryRefs.length} rel:${relationshipRefs.length} propRel:${propertyRelRefs.length} assocRel:${associationRelRefs.length} type:${typeObjectRefs.length} other:${otherRelevantRefs.length}`);

        // Create entity table builder with EXACT capacity (not totalEntities which
        // includes millions of geometry-representation entities we don't store).
        // For a 14M entity file, this reduces allocation from ~546MB to ~20MB.
        const relevantCount = spatialRefs.length + geometryRefs.length + typeObjectRefs.length
            + relationshipRefs.length + otherRelevantRefs.length;
        const entityTableBuilder = new EntityTableBuilder(relevantCount, strings);

        const entityIndex = {
            byId: compactByIdIndex as EntityByIdIndex,
            byType,
        };

        // Time-based yielding: yield to the main thread every ~80ms so geometry
        // streaming callbacks can fire. This limits main-thread blocking to short
        // bursts that don't starve geometry, while adding minimal overhead (~15 yields
        // × ~1ms each ≈ 15ms total over the full parse).
        const YIELD_INTERVAL_MS = 80;
        let lastYieldTime = performance.now();
        const yieldIfNeeded = async () => {
            const now = performance.now();
            if (now - lastYieldTime >= YIELD_INTERVAL_MS) {
                await new Promise<void>(resolve => setTimeout(resolve, 0));
                lastYieldTime = performance.now();
            }
        };

        // === TARGETED PARSING using batch byte-level extraction ===
        // Uses 2 TextDecoder.decode() calls total for ALL entity GlobalIds/Names
        // (instead of per-entity calls), and pure byte scanning for relationships.
        options.onProgress?.({ phase: 'parsing entities', percent: 10 });

        const extractor = new EntityExtractor(uint8Buffer);

        // Spatial entities: small count, use extractEntity for full accuracy
        const parsedEntityData = new Map<number, { globalId: string; name: string }>();
        for (const ref of spatialRefs) {
            const entity = extractor.extractEntity(ref);
            if (entity) {
                const attrs = entity.attributes || [];
                parsedEntityData.set(ref.expressId, {
                    globalId: typeof attrs[0] === 'string' ? attrs[0] : '',
                    name: typeof attrs[2] === 'string' ? attrs[2] : '',
                });
            }
        }
        logPhase('spatial entities');

        await yieldIfNeeded();

        // Geometry + type object entities: batch extract GlobalId+Name with 2 TextDecoder calls
        options.onProgress?.({ phase: 'parsing geometry names', percent: 12 });
        const geomData = batchExtractGlobalIdAndName(uint8Buffer, geometryRefs);
        for (const [id, data] of geomData) parsedEntityData.set(id, data);

        await yieldIfNeeded();

        const typeData = batchExtractGlobalIdAndName(uint8Buffer, typeObjectRefs);
        for (const [id, data] of typeData) parsedEntityData.set(id, data);
        logPhase('batch geom GlobalId+Name');

        await yieldIfNeeded();

        // Relationships: byte-level scanning (numbers only, no TextDecoder)
        options.onProgress?.({ phase: 'parsing relationships', percent: 20 });

        // Use a toUpperCase cache across relationship refs (same type name set)
        const typeUpperCache = new Map<string, string>();
        const getTypeUpper = (type: string) => {
            let u = typeUpperCache.get(type);
            if (u === undefined) { u = type.toUpperCase(); typeUpperCache.set(type, u); }
            return u;
        };

        for (const ref of relationshipRefs) {
            const typeUpper = getTypeUpper(ref.type);
            const rel = extractRelFast(uint8Buffer, ref.byteOffset, ref.byteLength, typeUpper);
            if (rel) {
                const relType = REL_TYPE_MAP[typeUpper];
                if (relType) {
                    for (const targetId of rel.relatedObjects) {
                        relationshipGraphBuilder.addEdge(rel.relatingObject, targetId, relType, ref.expressId);
                    }
                }
            }
        }

        logPhase('byte-level relationships');

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
        logPhase('add entity batches');

        const entityTable = entityTableBuilder.build();
        logPhase('entity table build()');

        // Empty property/quantity tables - use on-demand extraction instead
        const propertyTable = propertyTableBuilder.build();
        const quantityTable = quantityTableBuilder.build();

        // Build intermediate relationship graph (spatial/hierarchy edges only).
        // Property/association edges are added later; final graph is rebuilt at the end.
        const hierarchyRelGraph = relationshipGraphBuilder.build();
        logPhase('hierarchy rel graph build()');

        await yieldIfNeeded();

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
            logPhase('spatial hierarchy');
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

        await yieldIfNeeded(); // Let geometry process after hierarchy emission

        // === DEFERRED: Parse property and association relationships ===
        // These are NOT needed for the spatial hierarchy panel.
        options.onProgress?.({ phase: 'parsing property refs', percent: 92 });

        const onDemandPropertyMap = new Map<number, number[]>();
        const onDemandQuantityMap = new Map<number, number[]>();

        // Pre-build Sets of property set / quantity set IDs from already-categorized refs.
        // This replaces 252K binary searches on the 14M compact entity index with O(1) Set lookups.
        const propertySetIds = new Set<number>();
        const quantitySetIds = new Set<number>();
        for (const ref of propertyEntityRefs) {
            const tu = getTypeUpper(ref.type);
            if (tu === 'IFCPROPERTYSET') propertySetIds.add(ref.expressId);
            else if (tu === 'IFCELEMENTQUANTITY') quantitySetIds.add(ref.expressId);
        }

        // Property rels: byte-level scanning + addEdge (now fast with SoA builder).
        let totalPropRelObjects = 0;
        for (let pi = 0; pi < propertyRelRefs.length; pi++) {
            if ((pi & 0x3FF) === 0) await yieldIfNeeded();
            const ref = propertyRelRefs[pi];
            const result = extractPropertyRelFast(uint8Buffer, ref.byteOffset, ref.byteLength);
            if (result) {
                const { relatedObjects, relatingDef } = result;
                totalPropRelObjects += relatedObjects.length;

                for (const objId of relatedObjects) {
                    relationshipGraphBuilder.addEdge(relatingDef, objId, RelationshipType.DefinesByProperties, ref.expressId);
                }

                // Build on-demand property/quantity maps using pre-built Sets (O(1) vs binary search)
                const isPropSet = propertySetIds.has(relatingDef);
                const isQtySet = !isPropSet && quantitySetIds.has(relatingDef);

                if (isPropSet || isQtySet) {
                    const targetMap = isPropSet ? onDemandPropertyMap : onDemandQuantityMap;
                    for (const objId of relatedObjects) {
                        let list = targetMap.get(objId);
                        if (!list) { list = []; targetMap.set(objId, list); }
                        list.push(relatingDef);
                    }
                }
            }
        }
        await yieldIfNeeded();

        // Association rels: byte-level scanning, no addEdge (same reasoning as property rels)
        options.onProgress?.({ phase: 'parsing associations', percent: 95 });

        const onDemandClassificationMap = new Map<number, number[]>();
        const onDemandMaterialMap = new Map<number, number>();
        const onDemandDocumentMap = new Map<number, number[]>();

        for (const ref of associationRelRefs) {
            const result = extractPropertyRelFast(uint8Buffer, ref.byteOffset, ref.byteLength);
            if (result) {
                const { relatedObjects, relatingDef: relatingRef } = result;
                const typeUpper = getTypeUpper(ref.type);

                if (typeUpper === 'IFCRELASSOCIATESCLASSIFICATION') {
                    for (const objId of relatedObjects) {
                        let list = onDemandClassificationMap.get(objId);
                        if (!list) { list = []; onDemandClassificationMap.set(objId, list); }
                        list.push(relatingRef);
                        relationshipGraphBuilder.addEdge(relatingRef, objId, RelationshipType.AssociatesClassification, ref.expressId);
                    }
                } else if (typeUpper === 'IFCRELASSOCIATESMATERIAL') {
                    for (const objId of relatedObjects) {
                        onDemandMaterialMap.set(objId, relatingRef);
                        relationshipGraphBuilder.addEdge(relatingRef, objId, RelationshipType.AssociatesMaterial, ref.expressId);
                    }
                } else if (typeUpper === 'IFCRELASSOCIATESDOCUMENT') {
                    for (const objId of relatedObjects) {
                        let list = onDemandDocumentMap.get(objId);
                        if (!list) { list = []; onDemandDocumentMap.set(objId, list); }
                        list.push(relatingRef);
                        relationshipGraphBuilder.addEdge(relatingRef, objId, RelationshipType.AssociatesDocument, ref.expressId);
                    }
                }
            }
        }

        logPhase('property+association rels');

        // Rebuild relationship graph with ALL edges (hierarchy + property + association)
        const fullRelationshipGraph = relationshipGraphBuilder.build();
        logPhase('relationship graph build()');

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
