/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/parser - Main parser interface
 * Supports both IFC4 (STEP) and IFC5 (IFCX/JSON) formats
 */

export { StepTokenizer } from './tokenizer.js';
export { EntityIndexBuilder } from './entity-index.js';
export { EntityExtractor } from './entity-extractor.js';
export { PropertyExtractor } from './property-extractor.js';
export { QuantityExtractor } from './quantity-extractor.js';
export { RelationshipExtractor } from './relationship-extractor.js';
export { StyleExtractor } from './style-extractor.js';
export { SpatialHierarchyBuilder } from './spatial-hierarchy-builder.js';
export { ColumnarParser, type IfcDataStore } from './columnar-parser.js';
export { WorkerParser } from './worker-parser.js';

// IFC5 (IFCX) support - re-export from @ifc-lite/ifcx
export {
  parseIfcx,
  detectFormat,
  composeIfcx,
  type IfcxParseResult,
  type IfcxFile,
  type IfcxNode,
  type ComposedNode,
  type MeshData as IfcxMeshData,
} from '@ifc-lite/ifcx';

// New extractors with 100% schema coverage
export { extractMaterials, getMaterialForElement, getMaterialNameForElement, type MaterialsData, type Material, type MaterialLayer, type MaterialLayerSet } from './material-extractor.js';
export { extractGeoreferencing, transformToWorld, transformToLocal, getCoordinateSystemDescription, type GeoreferenceInfo, type MapConversion, type ProjectedCRS } from './georef-extractor.js';
export { extractClassifications, getClassificationsForElement, getClassificationCodeForElement, getClassificationPath, groupElementsByClassification, type ClassificationsData, type Classification, type ClassificationReference } from './classification-extractor.js';

// Generated IFC4 schema (100% coverage - 776 entities, 397 types, 207 enums)
export { SCHEMA_REGISTRY, getEntityMetadata, getAllAttributesForEntity, getInheritanceChainForEntity, isKnownEntity } from './generated/schema-registry.js';
export type * from './generated/entities.js';
export * from './generated/enums.js';

export * from './types.js';
export * from './style-extractor.js';
export { getAttributeNames, getAttributeNameAt, isKnownType } from './ifc-schema.js';

import type { ParseResult, EntityRef } from './types.js';
import { StepTokenizer } from './tokenizer.js';
import { EntityIndexBuilder } from './entity-index.js';
import { EntityExtractor } from './entity-extractor.js';
import { PropertyExtractor } from './property-extractor.js';
import { RelationshipExtractor } from './relationship-extractor.js';
import { ColumnarParser, type IfcDataStore } from './columnar-parser.js';

export interface ParseOptions {
  onProgress?: (progress: { phase: string; percent: number }) => void;
}

/**
 * Main parser class
 */
export class IfcParser {
  /**
   * Parse IFC file into structured data
   */
  async parse(buffer: ArrayBuffer, options: ParseOptions = {}): Promise<ParseResult> {
    const uint8Buffer = new Uint8Array(buffer);

    // Phase 1: Scan for entities
    options.onProgress?.({ phase: 'scan', percent: 0 });
    const tokenizer = new StepTokenizer(uint8Buffer);
    const indexBuilder = new EntityIndexBuilder();

    let scanned = 0;
    const entityRefs: EntityRef[] = [];

    for (const ref of tokenizer.scanEntities()) {
      indexBuilder.addEntity({
        expressId: ref.expressId,
        type: ref.type,
        byteOffset: ref.offset,
        byteLength: ref.length,
        lineNumber: ref.line,
      });
      entityRefs.push({
        expressId: ref.expressId,
        type: ref.type,
        byteOffset: ref.offset,
        byteLength: ref.length,
        lineNumber: ref.line,
      });
      scanned++;
    }

    const entityIndex = indexBuilder.build();
    options.onProgress?.({ phase: 'scan', percent: 100 });

    // Phase 2: Extract entities
    options.onProgress?.({ phase: 'extract', percent: 0 });
    const extractor = new EntityExtractor(uint8Buffer);
    const entities = new Map<number, any>();

    for (let i = 0; i < entityRefs.length; i++) {
      const ref = entityRefs[i];
      const entity = extractor.extractEntity(ref);
      if (entity) {
        entities.set(ref.expressId, entity);
      }
      if ((i + 1) % 1000 === 0) {
        options.onProgress?.({ phase: 'extract', percent: ((i + 1) / entityRefs.length) * 100 });
      }
    }

    options.onProgress?.({ phase: 'extract', percent: 100 });

    // Phase 3: Extract properties
    options.onProgress?.({ phase: 'properties', percent: 0 });
    const propertyExtractor = new PropertyExtractor(entities);
    const propertySets = propertyExtractor.extractPropertySets();
    options.onProgress?.({ phase: 'properties', percent: 100 });

    // Phase 4: Extract relationships
    options.onProgress?.({ phase: 'relationships', percent: 0 });
    const relationshipExtractor = new RelationshipExtractor(entities);
    const relationships = relationshipExtractor.extractRelationships();
    options.onProgress?.({ phase: 'relationships', percent: 100 });

    return {
      entities,
      propertySets,
      relationships,
      entityIndex,
      fileSize: buffer.byteLength,
      entityCount: entities.size,
    };
  }
  
  /**
   * Parse IFC file into columnar data store (new format)
   * OPTIMIZED: Combined scan + extract for maximum performance
   */
  async parseColumnar(buffer: ArrayBuffer, options: ParseOptions = {}): Promise<IfcDataStore> {
    const uint8Buffer = new Uint8Array(buffer);
    const startTime = performance.now();

    // OPTIMIZED: Combined scan + extract in one pass
    options.onProgress?.({ phase: 'scanning', percent: 0 });
    const tokenizer = new StepTokenizer(uint8Buffer);
    const indexBuilder = new EntityIndexBuilder();
    const extractor = new EntityExtractor(uint8Buffer);

    const entityRefs: EntityRef[] = [];
    const entities = new Map<number, any>();

    let processed = 0;
    const YIELD_INTERVAL = 5000; // Yield less frequently for better throughput

    // Single pass: scan AND extract simultaneously
    for (const ref of tokenizer.scanEntities()) {
      // Add to index
      indexBuilder.addEntity({
        expressId: ref.expressId,
        type: ref.type,
        byteOffset: ref.offset,
        byteLength: ref.length,
        lineNumber: ref.line,
      });

      const entityRef: EntityRef = {
        expressId: ref.expressId,
        type: ref.type,
        byteOffset: ref.offset,
        byteLength: ref.length,
        lineNumber: ref.line,
      };
      entityRefs.push(entityRef);

      // Extract entity immediately
      const entity = extractor.extractEntity(entityRef);
      if (entity) {
        entities.set(ref.expressId, entity);
      }

      processed++;
      // Yield and report progress every YIELD_INTERVAL entities
      if (processed % YIELD_INTERVAL === 0) {
        options.onProgress?.({ phase: 'scanning', percent: Math.min(90, processed / 1000) }); // Approximate progress
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    indexBuilder.build();
    const scanExtractTime = performance.now() - startTime;
    console.log(`[IfcParser] Scan+Extract: ${processed} entities in ${scanExtractTime.toFixed(0)}ms`);

    options.onProgress?.({ phase: 'scanning', percent: 100 });

    // Phase 2: Build columnar structures (single-pass optimized)
    const columnarParser = new ColumnarParser();
    return columnarParser.parse(buffer, entityRefs, entities, options);
  }
}

// Import for auto-parser
import { parseIfcx, detectFormat, type IfcxParseResult, type MeshData as IfcxMeshData } from '@ifc-lite/ifcx';

/**
 * Result type for auto-parsing (union of IFC4 and IFC5 results)
 */
export type AutoParseResult = {
  format: 'ifc';
  data: IfcDataStore;
  meshes?: undefined;
} | {
  format: 'ifcx';
  data: IfcxParseResult;
  meshes: IfcxMeshData[];
};

/**
 * Auto-detect file format and parse accordingly.
 * Returns unified result with format indicator.
 */
export async function parseAuto(
  buffer: ArrayBuffer,
  options: ParseOptions = {}
): Promise<AutoParseResult> {
  const format = detectFormat(buffer);

  if (format === 'ifcx') {
    const result = await parseIfcx(buffer, options);
    return {
      format: 'ifcx',
      data: result,
      meshes: result.meshes,
    };
  }

  if (format === 'ifc') {
    const parser = new IfcParser();
    const data = await parser.parseColumnar(buffer, options);
    return {
      format: 'ifc',
      data,
    };
  }

  throw new Error('Unknown file format. Expected IFC (STEP) or IFCX (JSON).');
}
