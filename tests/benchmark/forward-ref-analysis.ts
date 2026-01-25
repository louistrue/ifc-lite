/**
 * Forward Reference Analysis - Feasibility Test
 *
 * Analyzes IFC files to measure:
 * 1. What % of entity references are forward (to higher IDs)?
 * 2. How deep are forward reference chains?
 * 3. What entity types have forward references?
 *
 * This validates the streaming pipeline feasibility.
 */

import * as fs from 'fs';
import * as path from 'path';

interface EntityInfo {
  id: number;
  type: string;
  refs: number[];
  start: number;
  end: number;
}

interface RefAnalysis {
  fileName: string;
  fileSize: number;
  totalEntities: number;
  totalRefs: number;
  backwardRefs: number;
  forwardRefs: number;
  forwardRefPercent: number;
  entitiesWithForwardRefs: number;
  entitiesWithForwardRefsPercent: number;
  maxForwardRefDistance: number;
  forwardRefsByType: Map<string, number>;
  // For streaming simulation
  wouldQueueCount: number;
  maxQueueDepth: number;
  avgQueueDepth: number;
}

/**
 * Extract all #ID references from entity bytes
 */
function extractRefs(content: string, start: number, end: number): number[] {
  const entityStr = content.slice(start, end);
  const refs: number[] = [];
  const regex = /#(\d+)/g;
  let match;

  // Skip the entity's own ID (first #ID before =)
  const eqPos = entityStr.indexOf('=');
  const searchStr = eqPos >= 0 ? entityStr.slice(eqPos) : entityStr;

  while ((match = regex.exec(searchStr)) !== null) {
    refs.push(parseInt(match[1], 10));
  }

  return refs;
}

/**
 * Parse IFC file and extract entity info
 */
function parseEntities(content: string): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const lines = content.split('\n');

  let currentEntity = '';
  let currentStart = 0;
  let offset = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip header/footer
    if (trimmed.startsWith('ISO-') || trimmed.startsWith('HEADER') ||
        trimmed.startsWith('ENDSEC') || trimmed.startsWith('DATA') ||
        trimmed.startsWith('END-ISO') || trimmed === '') {
      offset += line.length + 1;
      continue;
    }

    // Accumulate multi-line entities
    if (trimmed.startsWith('#')) {
      if (currentEntity) {
        // Flush previous
        const parsed = parseEntityLine(currentEntity, currentStart, offset - 1);
        if (parsed) entities.push(parsed);
      }
      currentEntity = trimmed;
      currentStart = offset;
    } else if (currentEntity) {
      currentEntity += ' ' + trimmed;
    }

    // Check if entity is complete (ends with ;)
    if (currentEntity && currentEntity.endsWith(';')) {
      const parsed = parseEntityLine(currentEntity, currentStart, offset + line.length);
      if (parsed) entities.push(parsed);
      currentEntity = '';
    }

    offset += line.length + 1;
  }

  // Handle last entity
  if (currentEntity) {
    const parsed = parseEntityLine(currentEntity, currentStart, offset);
    if (parsed) entities.push(parsed);
  }

  return entities;
}

function parseEntityLine(line: string, start: number, end: number): EntityInfo | null {
  // Pattern: #123=IFCTYPE(...)
  const match = line.match(/^#(\d+)\s*=\s*(\w+)\s*\(/);
  if (!match) return null;

  const id = parseInt(match[1], 10);
  const type = match[2];
  const refs = extractRefs(line, 0, line.length);

  return { id, type, refs, start, end };
}

/**
 * Analyze reference patterns
 */
function analyzeRefs(entities: EntityInfo[], fileName: string, fileSize: number): RefAnalysis {
  const entityIds = new Set(entities.map(e => e.id));
  const forwardRefsByType = new Map<string, number>();

  let totalRefs = 0;
  let backwardRefs = 0;
  let forwardRefs = 0;
  let entitiesWithForwardRefs = 0;
  let maxForwardRefDistance = 0;

  // Simulate streaming: track queue depth
  const indexed = new Set<number>();
  let currentQueueDepth = 0;
  let maxQueueDepth = 0;
  let totalQueueDepth = 0;
  let queueSamples = 0;
  let wouldQueueCount = 0;

  for (const entity of entities) {
    // Simulate indexing this entity
    indexed.add(entity.id);

    // Check refs
    let hasForwardRef = false;
    for (const ref of entity.refs) {
      // Only count refs to actual entities in file
      if (!entityIds.has(ref)) continue;

      totalRefs++;

      if (ref > entity.id) {
        // Forward reference
        forwardRefs++;
        hasForwardRef = true;
        const distance = ref - entity.id;
        maxForwardRefDistance = Math.max(maxForwardRefDistance, distance);

        // Track by type
        const count = forwardRefsByType.get(entity.type) || 0;
        forwardRefsByType.set(entity.type, count + 1);
      } else {
        backwardRefs++;
      }
    }

    if (hasForwardRef) {
      entitiesWithForwardRefs++;
      wouldQueueCount++;
      currentQueueDepth++;
    }

    // Simulate resolving queued entities (simplified: assume resolved when ref is indexed)
    // In reality this is more complex, but gives rough estimate
    if (currentQueueDepth > 0) {
      // Check if any queued entities can now resolve
      // Simplified: reduce queue by 10% each step (rough approximation)
      currentQueueDepth = Math.max(0, currentQueueDepth - Math.ceil(currentQueueDepth * 0.1));
    }

    maxQueueDepth = Math.max(maxQueueDepth, currentQueueDepth);
    totalQueueDepth += currentQueueDepth;
    queueSamples++;
  }

  return {
    fileName,
    fileSize,
    totalEntities: entities.length,
    totalRefs,
    backwardRefs,
    forwardRefs,
    forwardRefPercent: totalRefs > 0 ? (forwardRefs / totalRefs) * 100 : 0,
    entitiesWithForwardRefs,
    entitiesWithForwardRefsPercent: entities.length > 0 ? (entitiesWithForwardRefs / entities.length) * 100 : 0,
    maxForwardRefDistance,
    forwardRefsByType,
    wouldQueueCount,
    maxQueueDepth,
    avgQueueDepth: queueSamples > 0 ? totalQueueDepth / queueSamples : 0,
  };
}

/**
 * Simulate streaming to measure time-to-first-geometry potential
 */
function simulateStreaming(entities: EntityInfo[]): {
  firstGeometryEntityIndex: number;
  percentBeforeFirstForwardRef: number;
} {
  const geometryTypes = new Set([
    'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN',
    'IFCPLATE', 'IFCROOF', 'IFCDOOR', 'IFCWINDOW', 'IFCFURNISHINGELEMENT',
    'IFCBUILDINGELEMENTPROXY', 'IFCMEMBER', 'IFCCURTAINWALL',
    'IFCEXTRUDEDAREASOLID', 'IFCFACETEDBREP', 'IFCTRIANGULATEDFACESET',
    'IFCPOLYGONALFACESET'
  ]);

  const indexed = new Set<number>();
  let firstGeometryIndex = -1;
  let firstForwardRefIndex = -1;

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    indexed.add(entity.id);

    // Check for forward refs
    const hasForwardRef = entity.refs.some(r => r > entity.id);
    if (hasForwardRef && firstForwardRefIndex === -1) {
      firstForwardRefIndex = i;
    }

    // Check if this is a geometry entity with all refs available
    if (geometryTypes.has(entity.type)) {
      const allRefsAvailable = entity.refs.every(r => indexed.has(r) || r > entities[entities.length - 1].id);
      if (allRefsAvailable && firstGeometryIndex === -1) {
        firstGeometryIndex = i;
      }
    }
  }

  return {
    firstGeometryEntityIndex: firstGeometryIndex,
    percentBeforeFirstForwardRef: firstForwardRefIndex >= 0
      ? (firstForwardRefIndex / entities.length) * 100
      : 100,
  };
}

// Main execution
async function main() {
  // Find test IFC files
  const testDataDirs = [
    path.join(process.cwd(), 'test-data'),
    path.join(process.cwd(), 'tests', 'fixtures'),
    path.join(process.cwd(), 'apps', 'viewer', 'public'),
  ];

  const ifcFiles: string[] = [];

  for (const dir of testDataDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir)
        .filter(f => f.toLowerCase().endsWith('.ifc'))
        .map(f => path.join(dir, f));
      ifcFiles.push(...files);
    }
  }

  // Also check command line args
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (fs.existsSync(arg) && arg.toLowerCase().endsWith('.ifc')) {
      ifcFiles.push(arg);
    }
  }

  if (ifcFiles.length === 0) {
    console.log('No IFC files found. Usage:');
    console.log('  npx tsx tests/benchmark/forward-ref-analysis.ts [file.ifc ...]');
    console.log('\nSearched directories:');
    testDataDirs.forEach(d => console.log(`  ${d}`));
    return;
  }

  console.log('='.repeat(80));
  console.log('FORWARD REFERENCE ANALYSIS - Streaming Pipeline Feasibility');
  console.log('='.repeat(80));
  console.log('');

  const results: RefAnalysis[] = [];

  for (const filePath of ifcFiles) {
    const fileName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileSize = fs.statSync(filePath).size;

    console.log(`Analyzing: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

    const entities = parseEntities(content);
    const analysis = analyzeRefs(entities, fileName, fileSize);
    const streaming = simulateStreaming(entities);

    results.push(analysis);

    console.log(`  Entities: ${analysis.totalEntities.toLocaleString()}`);
    console.log(`  Total refs: ${analysis.totalRefs.toLocaleString()}`);
    console.log(`  Backward refs: ${analysis.backwardRefs.toLocaleString()} (${(100 - analysis.forwardRefPercent).toFixed(2)}%)`);
    console.log(`  Forward refs: ${analysis.forwardRefs.toLocaleString()} (${analysis.forwardRefPercent.toFixed(2)}%)`);
    console.log(`  Entities with forward refs: ${analysis.entitiesWithForwardRefs.toLocaleString()} (${analysis.entitiesWithForwardRefsPercent.toFixed(2)}%)`);
    console.log(`  Max forward ref distance: ${analysis.maxForwardRefDistance.toLocaleString()} entities`);
    console.log(`  Streaming simulation:`);
    console.log(`    Would queue: ${analysis.wouldQueueCount.toLocaleString()} entities`);
    console.log(`    Max queue depth: ${analysis.maxQueueDepth}`);
    console.log(`    First geometry entity: #${streaming.firstGeometryEntityIndex}`);
    console.log(`    % processed before first forward ref: ${streaming.percentBeforeFirstForwardRef.toFixed(1)}%`);

    if (analysis.forwardRefsByType.size > 0) {
      console.log(`  Forward refs by entity type:`);
      const sorted = [...analysis.forwardRefsByType.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [type, count] of sorted) {
        console.log(`    ${type}: ${count}`);
      }
    }

    console.log('');
  }

  // Summary
  if (results.length > 1) {
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const avgForwardRefPercent = results.reduce((s, r) => s + r.forwardRefPercent, 0) / results.length;
    const avgEntitiesWithForwardRefs = results.reduce((s, r) => s + r.entitiesWithForwardRefsPercent, 0) / results.length;
    const maxMaxForwardDist = Math.max(...results.map(r => r.maxForwardRefDistance));

    console.log(`Average forward refs: ${avgForwardRefPercent.toFixed(2)}%`);
    console.log(`Average entities with forward refs: ${avgEntitiesWithForwardRefs.toFixed(2)}%`);
    console.log(`Max forward ref distance across all files: ${maxMaxForwardDist}`);
    console.log('');

    if (avgForwardRefPercent < 10) {
      console.log('✅ FEASIBILITY: HIGH');
      console.log('   Forward references are rare enough that streaming pipeline should work well.');
      console.log(`   ~${(100 - avgForwardRefPercent).toFixed(0)}% of geometry can be processed immediately.`);
    } else if (avgForwardRefPercent < 25) {
      console.log('⚠️  FEASIBILITY: MODERATE');
      console.log('   Significant forward references. Streaming will help but queue management needed.');
    } else {
      console.log('❌ FEASIBILITY: LOW');
      console.log('   Too many forward references for streaming to provide significant benefit.');
    }
  }
}

main().catch(console.error);
