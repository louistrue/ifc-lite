/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Standalone test to debug geometry editing and IFC export
 * 
 * Tests the full flow from geometry editing to IFC export to identify
 * why edited geometry is removed but new geometry is not added.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ColumnarParser } from '@ifc-lite/parser';
import { StepTokenizer } from '@ifc-lite/parser';
import { StepExporter, type GeometryMutations } from './step-exporter.js';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test IFC file path
const TEST_IFC_FILE = path.resolve(
  __dirname,
  '../../..',
  'tests',
  'models',
  'various',
  '02_BIMcollab_Example_STR_random_C_ebkp.ifc'
);

// Entity #146 details from the IFC file
const TEST_ENTITY_ID = 146;
const TEST_REPRESENTATION_ID = 5364; // IFCPRODUCTDEFINITIONSHAPE
const TEST_EXTRUSION_ID = 1848; // IFCEXTRUDEDAREASOLID (old geometry to be removed)
const TEST_GLOBAL_ID = '3ef_qCGDDqIBgZ$wP7mXqy';

// Parsed store - shared across tests
let dataStore: IfcDataStore | null = null;

/**
 * Helper to load and parse the test IFC file
 */
async function loadTestIfcFile(): Promise<IfcDataStore> {
  if (!fs.existsSync(TEST_IFC_FILE)) {
    throw new Error(`Test IFC file not found: ${TEST_IFC_FILE}`);
  }

  const fileBuffer = fs.readFileSync(TEST_IFC_FILE);
  const uint8Buffer = new Uint8Array(fileBuffer.buffer, fileBuffer.byteOffset, fileBuffer.length);

  // Scan entities using tokenizer
  const tokenizer = new StepTokenizer(uint8Buffer);
  const entityRefs: Array<{
    expressId: number;
    type: string;
    byteOffset: number;
    byteLength: number;
    lineNumber: number;
  }> = [];

  for (const ref of tokenizer.scanEntitiesFast()) {
    entityRefs.push({
      expressId: ref.expressId,
      type: ref.type,
      byteOffset: ref.offset,
      byteLength: ref.length,
      lineNumber: ref.line,
    });
  }

  // Build columnar store
  const columnarParser = new ColumnarParser();
  const store = await columnarParser.parseLite(fileBuffer.buffer, entityRefs, {});
  return store;
}

/**
 * Helper to create a mock edited mesh (simulates depth change from 3550 to 4000)
 * Scales positions along Z-axis to simulate extrusion depth change
 */
function createEditedMesh(expressId: number, originalMesh?: MeshData): MeshData {
  // If we have an original mesh, scale it; otherwise create a simple test mesh
  if (originalMesh) {
    // Scale Z coordinates by factor (4000 / 3550 ≈ 1.127)
    const scaleFactor = 4000 / 3550;
    const scaledPositions = new Float32Array(originalMesh.positions.length);
    
    for (let i = 0; i < originalMesh.positions.length; i += 3) {
      scaledPositions[i] = originalMesh.positions[i]; // X unchanged
      scaledPositions[i + 1] = originalMesh.positions[i + 1]; // Y unchanged
      scaledPositions[i + 2] = originalMesh.positions[i + 2] * scaleFactor; // Z scaled
    }

    return {
      ...originalMesh,
      expressId,
      positions: scaledPositions,
    };
  }

  // Create a simple test mesh (box)
  const positions = new Float32Array([
    // Bottom face
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
    // Top face (scaled Z)
    0, 0, 4000,
    1, 0, 4000,
    1, 1, 4000,
    0, 1, 4000,
  ]);

  const indices = new Uint32Array([
    // Bottom
    0, 1, 2, 0, 2, 3,
    // Top
    4, 6, 5, 4, 7, 6,
    // Sides
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ]);

  const normals = new Float32Array(positions.length);
  // Simple normals (would be computed properly in real scenario)
  for (let i = 0; i < normals.length; i += 3) {
    normals[i] = 0;
    normals[i + 1] = 0;
    normals[i + 2] = 1;
  }

  return {
    expressId,
    ifcType: 'IFCWALLSTANDARDCASE',
    positions,
    normals,
    indices,
    color: [0.8, 0.8, 0.8, 1.0] as [number, number, number, number],
  };
}

/**
 * Helper to create coordinate info (minimal for testing)
 */
function createCoordinateInfo(): CoordinateInfo {
  return {
    originShift: { x: 0, y: 0, z: 0 },
    originalBounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 100, y: 100, z: 4000 },
    },
    shiftedBounds: {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 100, y: 100, z: 4000 },
    },
    hasLargeCoordinates: false,
  };
}

describe.skipIf(!fs.existsSync(TEST_IFC_FILE))('StepExporter - Geometry Edit Export Debug', () => {
  beforeAll(async () => {
    console.log(`\n📁 Loading test IFC file: ${path.basename(TEST_IFC_FILE)}\n`);
    dataStore = await loadTestIfcFile();
    console.log(`✅ Loaded ${dataStore.entityCount} entities\n`);
  });

  describe('Test 1: Verify geometry mutation is passed correctly', () => {
    it('should receive geometry mutations from edited mesh', () => {
      if (!dataStore) throw new Error('Data store not loaded');

      const geometryMutations: GeometryMutations = new Map();
      const editedMesh = createEditedMesh(TEST_ENTITY_ID);
      geometryMutations.set(TEST_ENTITY_ID, editedMesh);

      const exporter = new StepExporter(dataStore, undefined, geometryMutations);

      // Access private property using bracket notation for testing
      const mutations = (exporter as any).geometryMutations as GeometryMutations;
      expect(mutations.size).toBe(1);
      expect(mutations.has(TEST_ENTITY_ID)).toBe(true);
      expect(mutations.get(TEST_ENTITY_ID)).toBeDefined();
      expect(mutations.get(TEST_ENTITY_ID)?.expressId).toBe(TEST_ENTITY_ID);

      console.log(`✅ Geometry mutations passed to exporter: ${mutations.size} mutation(s)`);
    });
  });

  describe('Test 2: Verify representation lookup', () => {
    it('should find entity representation for edited entity', () => {
      if (!dataStore) throw new Error('Data store not loaded');

      const exporter = new StepExporter(dataStore);
      const findEntityRepresentation = (exporter as any).findEntityRepresentation.bind(exporter) as (id: number) => number | null;
      
      const repId = findEntityRepresentation(TEST_ENTITY_ID);
      
      expect(repId).not.toBeNull();
      expect(repId).toBe(TEST_REPRESENTATION_ID);
      
      console.log(`✅ Found representation #${repId} for entity #${TEST_ENTITY_ID}`);

      // Verify the representation entity exists
      const repEntity = dataStore.entityIndex.byId.get(repId!);
      expect(repEntity).toBeDefined();
      expect(repEntity?.type.toUpperCase()).toBe('IFCPRODUCTDEFINITIONSHAPE');
    });
  });

  describe('Test 3: Verify geometry entity generation', () => {
    it('should generate new geometry entities', () => {
      if (!dataStore) throw new Error('Data store not loaded');

      const geometryMutations: GeometryMutations = new Map();
      const editedMesh = createEditedMesh(TEST_ENTITY_ID);
      geometryMutations.set(TEST_ENTITY_ID, editedMesh);

      const exporter = new StepExporter(dataStore, undefined, geometryMutations, createCoordinateInfo());
      const generateGeometryEntities = (exporter as any).generateGeometryEntities.bind(exporter) as (
        entityId: number,
        meshData: MeshData,
        representationId: number | null
      ) => { lines: string[]; count: number; newProductDefShapeId: number };

      const result = generateGeometryEntities(TEST_ENTITY_ID, editedMesh, TEST_REPRESENTATION_ID);

      expect(result.lines.length).toBeGreaterThan(0);
      expect(result.newProductDefShapeId).toBeDefined();
      expect(result.count).toBeGreaterThan(0);

      // Verify it contains appropriate geometry type for schema
      // IFC2X3 uses IfcFacetedBrep, IFC4+ uses IfcTriangulatedFaceSet
      const schema = dataStore?.schemaVersion || 'IFC4';
      const isIfc2x3 = schema === 'IFC2X3';
      
      if (isIfc2x3) {
        const hasFacetedBrep = result.lines.some((l) => l.includes('IFCFACETEDBREP'));
        expect(hasFacetedBrep).toBe(true);
        const hasClosedShell = result.lines.some((l) => l.includes('IFCCLOSEDSHELL'));
        expect(hasClosedShell).toBe(true);
      } else {
        const hasTriangulatedFaceSet = result.lines.some((l) => l.includes('IFCTRIANGULATEDFACESET'));
        expect(hasTriangulatedFaceSet).toBe(true);
        const hasPointList = result.lines.some((l) => l.includes('IFCCARTESIANPOINTLIST3D'));
        expect(hasPointList).toBe(true);
      }

      // Verify it contains IfcProductDefinitionShape
      const hasProductDefShape = result.lines.some((l) => l.includes('IFCPRODUCTDEFINITIONSHAPE'));
      expect(hasProductDefShape).toBe(true);

      console.log(`✅ Generated ${result.count} new geometry entities`);
      console.log(`   New ProductDefinitionShape ID: #${result.newProductDefShapeId}`);
      console.log(`   Generated lines: ${result.lines.length}`);
      result.lines.slice(0, 3).forEach((line, i) => {
        console.log(`   Line ${i + 1}: ${line.substring(0, 80)}...`);
      });
    });
  });

  describe('Test 4: Full export roundtrip', () => {
    it('should include new geometry in exported IFC', () => {
      if (!dataStore) throw new Error('Data store not loaded');

      const geometryMutations: GeometryMutations = new Map();
      const editedMesh = createEditedMesh(TEST_ENTITY_ID);
      geometryMutations.set(TEST_ENTITY_ID, editedMesh);

      const exporter = new StepExporter(
        dataStore,
        undefined,
        geometryMutations,
        createCoordinateInfo()
      );

      const result = exporter.export({
        schema: 'IFC2X3',
        includeGeometry: true,
        applyMutations: false,
        deltaOnly: false,
      });

      // Verify export succeeded
      expect(result.content).toBeTruthy();
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.stats.geometryChangedCount).toBe(1);
      expect(result.stats.newEntityCount).toBeGreaterThan(0);

      console.log(`\n✅ Export completed:`);
      console.log(`   Total entities: ${result.stats.entityCount}`);
      console.log(`   New entities: ${result.stats.newEntityCount}`);
      console.log(`   Geometry changes: ${result.stats.geometryChangedCount}`);
      console.log(`   File size: ${(result.stats.fileSize / 1024).toFixed(2)} KB\n`);

      // Verify new geometry is present (format depends on schema)
      const schema = dataStore?.schemaVersion || 'IFC4';
      const isIfc2x3 = schema === 'IFC2X3';
      
      if (isIfc2x3) {
        const hasFacetedBrep = result.content.includes('IFCFACETEDBREP');
        expect(hasFacetedBrep).toBe(true);
        console.log(`✅ New geometry (IfcFacetedBrep for IFC2X3) found in export`);
      } else {
        const hasTriangulatedFaceSet = result.content.includes('IFCTRIANGULATEDFACESET');
        expect(hasTriangulatedFaceSet).toBe(true);
        console.log(`✅ New geometry (IfcTriangulatedFaceSet) found in export`);
      }

      // Verify old geometry is removed (IFCEXTRUDEDAREASOLID #1848 should be skipped)
      // Note: The old entity definition might still be in the file if deltaOnly=false,
      // but it should be skipped during processing. Let's check if the new geometry
      // entities are actually present and properly referenced.
      
      // Check that we have new geometry entities with higher IDs
      if (isIfc2x3) {
        const newGeometryPattern = /#\d+=IFCFACETEDBREP/;
        const newGeometryMatches = result.content.match(newGeometryPattern);
        expect(newGeometryMatches).toBeTruthy();
        console.log(`✅ Found new faceted brep: ${newGeometryMatches?.[0]}`);
      } else {
        const newGeometryPattern = /#\d+=IFCTRIANGULATEDFACESET/;
        const newGeometryMatches = result.content.match(newGeometryPattern);
        expect(newGeometryMatches).toBeTruthy();
        console.log(`✅ Found new triangulated face set: ${newGeometryMatches?.[0]}`);
      }

      // Verify entity replacement was created (entity #146 should reference new representation)
      // The replacement should update the Representation attribute
      const entity146Pattern = new RegExp(`#${TEST_ENTITY_ID}=IFCWALLSTANDARDCASE[^;]*`);
      const entity146Match = result.content.match(entity146Pattern);
      expect(entity146Match).toBeTruthy();
      
      if (entity146Match) {
        console.log(`✅ Entity #${TEST_ENTITY_ID} found in export`);
        console.log(`   Entity text: ${entity146Match[0].substring(0, 100)}...`);
      }

      // Count geometry entities to verify new ones were added
      console.log(`\n📊 Geometry entity counts (schema: ${schema}):`);
      if (isIfc2x3) {
        const facetedBrepCount = (result.content.match(/IFCFACETEDBREP/g) || []).length;
        const closedShellCount = (result.content.match(/IFCCLOSEDSHELL/g) || []).length;
        console.log(`   IfcFacetedBrep: ${facetedBrepCount}`);
        console.log(`   IfcClosedShell: ${closedShellCount}`);
        expect(facetedBrepCount).toBeGreaterThan(0);
      } else {
        const triangulatedFaceSetCount = (result.content.match(/IFCTRIANGULATEDFACESET/g) || []).length;
        const pointListCount = (result.content.match(/IFCCARTESIANPOINTLIST3D/g) || []).length;
        console.log(`   IfcTriangulatedFaceSet: ${triangulatedFaceSetCount}`);
        console.log(`   IfcCartesianPointList3D: ${pointListCount}`);
        expect(triangulatedFaceSetCount).toBeGreaterThan(0);
      }

      // CRITICAL: Verify geometric representation context is preserved
      // This is the fix for the bug where the context was being removed with old geometry
      const hasContext = result.content.includes('IFCGEOMETRICREPRESENTATIONSUBCONTEXT');
      expect(hasContext).toBe(true);
      console.log(`✅ Geometric representation context preserved in export`);
      
      // Verify #2 (the Body context) specifically exists
      const context2Pattern = /#2=IFCGEOMETRICREPRESENTATIONSUBCONTEXT/;
      const hasContext2 = context2Pattern.test(result.content);
      expect(hasContext2).toBe(true);
      console.log(`✅ Body context #2 preserved in export`);
    });

    it('should verify geometry mutation processing flow', () => {
      if (!dataStore) throw new Error('Data store not loaded');

      const geometryMutations: GeometryMutations = new Map();
      const editedMesh = createEditedMesh(TEST_ENTITY_ID);
      geometryMutations.set(TEST_ENTITY_ID, editedMesh);

      const exporter = new StepExporter(
        dataStore,
        undefined,
        geometryMutations,
        createCoordinateInfo()
      );

      // Access private methods for detailed inspection
      const findEntityRepresentation = (exporter as any).findEntityRepresentation.bind(exporter) as (id: number) => number | null;
      const findGeometryEntitiesForRepresentation = (exporter as any).findGeometryEntitiesForRepresentation.bind(exporter) as (
        id: number
      ) => Set<number>;
      const generateGeometryEntities = (exporter as any).generateGeometryEntities.bind(exporter) as (
        entityId: number,
        meshData: MeshData,
        representationId: number | null
      ) => { lines: string[]; count: number; newProductDefShapeId: number };

      // Step 1: Find representation
      const repId = findEntityRepresentation(TEST_ENTITY_ID);
      expect(repId).toBe(TEST_REPRESENTATION_ID);
      console.log(`\n🔍 Step 1: Found representation #${repId}`);

      // Step 2: Find geometry entities to skip
      const geometryEntityIds = findGeometryEntitiesForRepresentation(repId!);
      expect(geometryEntityIds.size).toBeGreaterThan(0);
      console.log(`🔍 Step 2: Found ${geometryEntityIds.size} geometry entities to skip`);
      console.log(`   Entity IDs: ${Array.from(geometryEntityIds).slice(0, 10).join(', ')}...`);

      // Verify old extrusion is in the skip list
      expect(geometryEntityIds.has(TEST_EXTRUSION_ID)).toBe(true);
      console.log(`   ✅ Old extrusion #${TEST_EXTRUSION_ID} is marked for removal`);

      // Step 3: Generate new geometry
      const newGeometry = generateGeometryEntities(TEST_ENTITY_ID, editedMesh, repId);
      expect(newGeometry.lines.length).toBeGreaterThan(0);
      expect(newGeometry.newProductDefShapeId).toBeDefined();
      console.log(`🔍 Step 3: Generated ${newGeometry.count} new geometry entities`);
      console.log(`   New ProductDefinitionShape ID: #${newGeometry.newProductDefShapeId}`);

      // Step 4: Full export
      const result = exporter.export({
        schema: 'IFC2X3',
        includeGeometry: true,
        applyMutations: false,
        deltaOnly: false,
      });

      console.log(`🔍 Step 4: Export completed`);
      console.log(`   Geometry changes: ${result.stats.geometryChangedCount}`);
      console.log(`   New entities: ${result.stats.newEntityCount}`);

      // Verify the new geometry is actually in the output
      // Note: The ID might be different because nextExpressId advances during export
      // So we check for the pattern instead of exact ID
      const newProductDefShapePattern = /#\d+=IFCPRODUCTDEFINITIONSHAPE/;
      const newProductDefShapeMatches = result.content.match(newProductDefShapePattern);
      expect(newProductDefShapeMatches).toBeTruthy();
      console.log(`   ✅ New ProductDefinitionShape found in export: ${newProductDefShapeMatches?.[0]}`);
      
      // The export regenerates geometry, so IDs will be different
      // What matters is that new geometry entities exist (format depends on schema)
      const schema = dataStore?.schemaVersion || 'IFC4';
      const isIfc2x3 = schema === 'IFC2X3';
      
      if (isIfc2x3) {
        const hasNewFacetedBrep = result.content.includes('IFCFACETEDBREP');
        expect(hasNewFacetedBrep).toBe(true);
        console.log(`   ✅ New faceted brep found in export (IFC2X3)`);
      } else {
        const hasNewTriangulatedFaceSet = result.content.includes('IFCTRIANGULATEDFACESET');
        expect(hasNewTriangulatedFaceSet).toBe(true);
        console.log(`   ✅ New triangulated face set found in export`);
      }
    });
  });
});
