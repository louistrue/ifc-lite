/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Integration tests for IFC Mutations (Property Editing and Export)
 *
 * Tests:
 * 1. MutablePropertyView with on-demand extraction
 * 2. BulkQueryEngine entity selection
 * 3. Property mutations (SET, DELETE)
 * 4. Full editing flow
 *
 * Run with: npx tsx tests/mutations.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test result tracking
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return (async () => {
    const start = Date.now();
    try {
      await fn();
      results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`✅ ${name}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      results.push({ name, passed: false, error: message, duration: Date.now() - start });
      console.log(`❌ ${name}: ${message}`);
    }
  })();
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertGreaterThan(actual: number, expected: number, message: string): void {
  if (actual <= expected) {
    throw new Error(`${message}: expected > ${expected}, got ${actual}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n🧪 IFC Mutations & Export Integration Tests\n');
  console.log('═'.repeat(60));

  // Find test IFC files
  const testFiles = [
    path.join(__dirname, 'models', 'ara3d', 'AC20-FZK-Haus.ifc'),
    path.join(__dirname, 'models', 'ara3d', 'IfcOpenHouse_IFC4.ifc'),
    path.join(__dirname, 'models', '01_BIMcollab_Example_ARC.ifc'),
    path.join(__dirname, 'models', 'test.ifc'),
  ];

  let testFile: string | null = null;
  for (const file of testFiles) {
    if (fs.existsSync(file)) {
      testFile = file;
      break;
    }
  }

  if (!testFile) {
    console.log('⚠️  No IFC test file found. Skipping integration tests.');
    console.log('   Expected files:', testFiles);
    return;
  }

  console.log(`\n📁 Using test file: ${path.basename(testFile)}\n`);

  // Load required modules - import directly from source files that don't have ifcx deps
  const { ColumnarParser, extractPropertiesOnDemand, extractQuantitiesOnDemand } = await import('../packages/parser/src/columnar-parser.js');
  const { StepTokenizer } = await import('../packages/parser/src/tokenizer.js');
  const { PropertyValueType } = await import('../packages/data/src/index.js');
  const { MutablePropertyView, BulkQueryEngine } = await import('../packages/mutations/src/index.js');

  // Parse the IFC file
  console.log('\n📖 Parsing IFC file...');
  const fileBuffer = fs.readFileSync(testFile);
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

  console.log(`   Scanned ${entityRefs.length} entity references`);

  // Build columnar store
  const columnarParser = new ColumnarParser();
  const store = await columnarParser.parseLite(fileBuffer.buffer, entityRefs, {});

  console.log(`   Entities: ${store.entities.count}`);
  console.log(`   On-demand property map: ${store.onDemandPropertyMap?.size ?? 0} entities`);
  console.log(`   On-demand quantity map: ${store.onDemandQuantityMap?.size ?? 0} entities`);
  console.log(`   Source buffer: ${store.source?.length ?? 0} bytes`);

  // ═══════════════════════════════════════════════════════════════
  // ON-DEMAND PROPERTY EXTRACTION TESTS
  // ═══════════════════════════════════════════════════════════════

  console.log('\n📦 On-Demand Property Extraction Tests');
  console.log('─'.repeat(40));

  await test('On-demand property map is populated', () => {
    assert(store.onDemandPropertyMap !== undefined, 'onDemandPropertyMap should exist');
    assertGreaterThan(store.onDemandPropertyMap!.size, 0, 'Should have entities with properties');
    console.log(`   Property map has ${store.onDemandPropertyMap!.size} entities`);
  });

  await test('extractPropertiesOnDemand returns properties for entity with properties', () => {
    // Get first entity ID that has properties
    const entityId = store.onDemandPropertyMap!.keys().next().value;
    if (entityId === undefined) {
      console.log('   ⚠️  No entities with properties found');
      return;
    }

    const properties = extractPropertiesOnDemand(store, entityId);
    assert(Array.isArray(properties), 'Should return an array');
    assertGreaterThan(properties.length, 0, 'Should return property sets for entity with properties');
    console.log(`   Entity ${entityId}: ${properties.length} property sets, ${properties.reduce((sum: number, p: { properties: unknown[] }) => sum + p.properties.length, 0)} properties`);
  });

  await test('extractPropertiesOnDemand returns empty for entity without properties', () => {
    // Find an entity without properties
    let entityWithoutProps: number | null = null;
    for (let i = 0; i < Math.min(store.entities.count, 100); i++) {
      const id = store.entities.expressId[i];
      if (!store.onDemandPropertyMap!.has(id)) {
        entityWithoutProps = id;
        break;
      }
    }

    if (entityWithoutProps === null) {
      console.log('   ⚠️  All entities have properties, skipping test');
      return;
    }

    const properties = extractPropertiesOnDemand(store, entityWithoutProps);
    assert(Array.isArray(properties), 'Should return an array');
    assert(properties.length === 0, `Should return empty for entity without properties, got ${properties.length}`);
  });

  // ═══════════════════════════════════════════════════════════════
  // MUTABLE PROPERTY VIEW TESTS
  // ═══════════════════════════════════════════════════════════════

  console.log('\n✏️  MutablePropertyView Tests');
  console.log('─'.repeat(40));

  await test('MutablePropertyView with on-demand extractor', () => {
    const view = new MutablePropertyView(store.properties, 'test-model');

    // Set up on-demand extractor
    view.setOnDemandExtractor((entityId: number) => {
      return extractPropertiesOnDemand(store, entityId);
    });

    // Get entity with properties
    const entityId = store.onDemandPropertyMap!.keys().next().value;
    if (entityId === undefined) {
      console.log('   ⚠️  No entities with properties found');
      return;
    }

    const props = view.getForEntity(entityId);
    assertGreaterThan(props.length, 0, 'Should return properties via on-demand extraction');
    console.log(`   Entity ${entityId}: ${props.length} property sets retrieved via MutablePropertyView`);
  });

  await test('MutablePropertyView setProperty creates mutation', () => {
    const view = new MutablePropertyView(store.properties, 'test-model');
    view.setOnDemandExtractor((entityId: number) => extractPropertiesOnDemand(store, entityId));

    // Get entity with properties
    const entityId = store.onDemandPropertyMap!.keys().next().value;
    if (entityId === undefined) {
      console.log('   ⚠️  No entities with properties found');
      return;
    }

    // Set a new property
    const mutation = view.setProperty(
      entityId,
      'TestPset',
      'TestProperty',
      'TestValue',
      PropertyValueType.String
    );

    assert(mutation !== null, 'Should return a mutation');
    assert(mutation.entityId === entityId, 'Mutation should have correct entityId');
    assert(mutation.psetName === 'TestPset', 'Mutation should have correct psetName');
    assert(mutation.propName === 'TestProperty', 'Mutation should have correct propName');
    assert(mutation.newValue === 'TestValue', 'Mutation should have correct newValue');

    // Verify the value can be retrieved
    const value = view.getPropertyValue(entityId, 'TestPset', 'TestProperty');
    assert(value === 'TestValue', 'Should be able to retrieve the set value');
    console.log(`   Created mutation: ${mutation.type} - ${mutation.psetName}/${mutation.propName}`);
  });

  await test('MutablePropertyView mutation history', () => {
    const view = new MutablePropertyView(store.properties, 'test-model');
    view.setOnDemandExtractor((entityId: number) => extractPropertiesOnDemand(store, entityId));

    const entityId = store.onDemandPropertyMap!.keys().next().value;
    if (entityId === undefined) {
      console.log('   ⚠️  No entities with properties found');
      return;
    }

    // Create multiple mutations
    view.setProperty(entityId, 'Pset1', 'Prop1', 'Value1', PropertyValueType.String);
    view.setProperty(entityId, 'Pset1', 'Prop2', 42, PropertyValueType.Integer);
    view.setProperty(entityId, 'Pset2', 'PropA', true, PropertyValueType.Boolean);

    const mutations = view.getMutations();
    assert(mutations.length === 3, `Should have 3 mutations, got ${mutations.length}`);
    assert(view.getModifiedEntityCount() === 1, 'Should have 1 modified entity');
    console.log(`   Created ${mutations.length} mutations for ${view.getModifiedEntityCount()} entities`);
  });

  // ═══════════════════════════════════════════════════════════════
  // BULK QUERY ENGINE TESTS
  // ═══════════════════════════════════════════════════════════════

  console.log('\n🔍 BulkQueryEngine Tests');
  console.log('─'.repeat(40));

  await test('BulkQueryEngine selects all entities with empty criteria', () => {
    const view = new MutablePropertyView(store.properties, 'test-model');
    view.setOnDemandExtractor((entityId: number) => extractPropertiesOnDemand(store, entityId));

    const engine = new BulkQueryEngine(
      store.entities,
      view,
      store.spatialHierarchy || null,
      store.properties || null,
      store.strings || null
    );

    const selected = engine.select({});
    assert(selected.length === store.entities.count, `Should select all ${store.entities.count} entities, got ${selected.length}`);
    console.log(`   Selected ${selected.length} entities (all)`);
  });

  await test('BulkQueryEngine filters by entity type', () => {
    const view = new MutablePropertyView(store.properties, 'test-model');
    view.setOnDemandExtractor((entityId: number) => extractPropertiesOnDemand(store, entityId));

    const engine = new BulkQueryEngine(
      store.entities,
      view,
      store.spatialHierarchy || null,
      store.properties || null,
      store.strings || null
    );

    // Find a type enum that exists in the model
    const typeEnumSet = new Set<number>();
    for (let i = 0; i < store.entities.count; i++) {
      typeEnumSet.add(store.entities.typeEnum[i]);
    }

    if (typeEnumSet.size === 0) {
      console.log('   ⚠️  No entity types found');
      return;
    }

    const firstType = typeEnumSet.values().next().value;
    const selected = engine.select({ entityTypes: [firstType] });
    assertGreaterThan(selected.length, 0, 'Should select entities of specified type');
    assert(selected.length < store.entities.count || typeEnumSet.size === 1, 'Should filter entities (unless only one type)');
    console.log(`   Selected ${selected.length} entities of type enum ${firstType}`);
  });

  await test('BulkQueryEngine executes bulk update', () => {
    const view = new MutablePropertyView(store.properties, 'test-model');
    view.setOnDemandExtractor((entityId: number) => extractPropertiesOnDemand(store, entityId));

    const engine = new BulkQueryEngine(
      store.entities,
      view,
      store.spatialHierarchy || null,
      store.properties || null,
      store.strings || null
    );

    // Get first 5 entity IDs
    const entityIds: number[] = [];
    for (let i = 0; i < Math.min(5, store.entities.count); i++) {
      entityIds.push(store.entities.expressId[i]);
    }

    const result = engine.execute({
      select: { expressIds: entityIds },
      action: {
        type: 'SET_PROPERTY',
        psetName: 'BulkTestPset',
        propName: 'BulkTestProp',
        value: 'BulkValue',
        valueType: PropertyValueType.String,
      },
    });

    assert(result.success, 'Bulk update should succeed');
    assert(result.mutations.length === entityIds.length, `Should create ${entityIds.length} mutations, got ${result.mutations.length}`);
    console.log(`   Bulk update created ${result.mutations.length} mutations for ${result.affectedEntityCount} entities`);
  });

  // ═══════════════════════════════════════════════════════════════
  // FULL EDITING FLOW TEST
  // ═══════════════════════════════════════════════════════════════

  console.log('\n🔄 Full Edit Flow Test');
  console.log('─'.repeat(40));

  await test('Full flow: Load -> Edit -> Verify', async () => {
    // Create mutation view with on-demand extraction
    const view = new MutablePropertyView(store.properties, 'full-test-model');
    view.setOnDemandExtractor((entityId: number) => extractPropertiesOnDemand(store, entityId));

    // Create query engine
    const engine = new BulkQueryEngine(
      store.entities,
      view,
      store.spatialHierarchy || null,
      store.properties || null,
      store.strings || null
    );

    // Step 1: Select entities
    const allEntities = engine.select({});
    console.log(`   Step 1: Selected ${allEntities.length} entities`);

    // Step 2: Apply bulk update to first 10 entities
    const targetEntities = allEntities.slice(0, 10);
    const updateResult = engine.execute({
      select: { expressIds: targetEntities },
      action: {
        type: 'SET_PROPERTY',
        psetName: 'FlowTestPset',
        propName: 'FlowTestProp',
        value: 'FlowTestValue',
        valueType: PropertyValueType.String,
      },
    });
    console.log(`   Step 2: Applied ${updateResult.mutations.length} mutations`);

    // Step 3: Verify mutations are in the view
    const mutations = view.getMutations();
    assert(mutations.length >= targetEntities.length, 'Should have at least as many mutations as target entities');
    console.log(`   Step 3: Verified ${mutations.length} mutations in view`);

    // Step 4: Verify property values are retrievable
    for (const entityId of targetEntities.slice(0, 3)) {
      const value = view.getPropertyValue(entityId, 'FlowTestPset', 'FlowTestProp');
      assert(value === 'FlowTestValue', `Entity ${entityId} should have correct value`);
    }
    console.log('   Step 4: Verified property values retrievable');

    console.log('   ✅ Full flow completed successfully');
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════

  console.log('\n' + '═'.repeat(60));
  console.log('📊 Test Summary');
  console.log('─'.repeat(40));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`   Total:  ${results.length}`);
  console.log(`   Passed: ${passed}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Time:   ${totalDuration}ms`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    for (const result of results.filter(r => !r.passed)) {
      console.log(`   - ${result.name}: ${result.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
