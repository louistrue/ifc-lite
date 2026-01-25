/**
 * Streaming Timing Simulation
 *
 * Simulates the streaming pipeline to measure:
 * 1. Time to first geometry (simulated)
 * 2. How many entities can be processed before needing to queue
 * 3. Queue drain timing
 */

import * as fs from 'fs';
import * as path from 'path';

interface EntityInfo {
  id: number;
  type: string;
  refs: number[];
  byteOffset: number;
  byteLength: number;
}

// Geometry types we can process
const GEOMETRY_ROOTS = new Set([
  'IFCFACETEDBREP', 'IFCEXTRUDEDAREASOLID', 'IFCTRIANGULATEDFACESET',
  'IFCPOLYGONALFACESET', 'IFCADVANCEDBREP', 'IFCSWEPTDISKSOLID',
  'IFCREVOLVEDAREASOLID', 'IFCBOOLEANCLIPPINGRESULT', 'IFCMAPPEDITEM',
  'IFCFACEBASEDSURFACEMODEL', 'IFCSURFACEOFLINEAREXTRUSION',
  'IFCSURFACECURVESWEPTAREASOLID'
]);

// Building elements that have geometry
const BUILDING_ELEMENTS = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN',
  'IFCPLATE', 'IFCROOF', 'IFCDOOR', 'IFCWINDOW', 'IFCFURNISHINGELEMENT',
  'IFCBUILDINGELEMENTPROXY', 'IFCMEMBER', 'IFCCURTAINWALL', 'IFCPILE',
  'IFCSHADINGDEVICE', 'IFCRAILING', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAMP', 'IFCRAMPFLIGHT', 'IFCCOVERING', 'IFCFOOTING'
]);

// Entity types that are NOT needed for geometry processing
const SKIP_FOR_GEOMETRY = new Set([
  'IFCRELCONTAINEDINSPATIALSTRUCTURE', 'IFCRELDEFINESBYTYPE',
  'IFCRELDEFINESBYPROPERTIES', 'IFCRELASSOCIATESMATERIAL',
  'IFCRELASSOCIATESCLASSIFICATION', 'IFCPRESENTATIONLAYERASSIGNMENT',
  'IFCRELAGGREGATES', 'IFCRELVOIDSELEMENT', 'IFCRELSPACEBOUNDARY',
  'IFCPROPERTYSET', 'IFCPROPERTYSINGLEVALUE', 'IFCELEMENTQUANTITY',
  'IFCOWNERHISTORY', 'IFCPERSON', 'IFCORGANIZATION', 'IFCAPPLICATION'
]);

function parseEntities(content: string): EntityInfo[] {
  const entities: EntityInfo[] = [];
  const regex = /#(\d+)\s*=\s*(\w+)\s*\(([^;]*)\);/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    const type = match[2];
    const args = match[3];
    const byteOffset = match.index;
    const byteLength = match[0].length;

    // Extract refs
    const refs: number[] = [];
    const refRegex = /#(\d+)/g;
    let refMatch;
    while ((refMatch = refRegex.exec(args)) !== null) {
      refs.push(parseInt(refMatch[1], 10));
    }

    entities.set(id, { id, type, refs, byteOffset, byteLength });
  }

  return entities;
}

interface StreamingSimulation {
  fileName: string;
  fileSize: number;
  totalEntities: number;
  buildingElements: number;
  geometryRoots: number;

  // Current pipeline timing (simulated)
  currentPipeline: {
    indexTime: number;      // ~0.5ms per 1000 entities
    scanTime: number;       // ~0.3ms per 1000 entities
    firstGeometryAt: number; // indexTime + scanTime + first process
  };

  // Streaming pipeline simulation
  streamingPipeline: {
    firstGeometryAt: number;       // When first entity can be processed
    firstBuildingElementAt: number; // When first wall/slab etc can be processed
    entitiesBeforeFirstQueue: number;
    totalQueued: number;
    maxQueueDepth: number;
    queueDrainTime: number;        // When all queued entities are processed
  };

  // Improvement
  improvement: {
    firstGeometrySpeedup: number;
    percentImmediatelyProcessable: number;
  };
}

function simulateStreaming(content: string, fileName: string, fileSize: number): StreamingSimulation {
  const entities: EntityInfo[] = [];
  const entityMap = new Map<number, EntityInfo>();
  const regex = /#(\d+)\s*=\s*(\w+)\s*\(([^;]*)\);/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const id = parseInt(match[1], 10);
    const type = match[2];
    const args = match[3];
    const byteOffset = match.index;
    const byteLength = match[0].length;

    const refs: number[] = [];
    const refRegex = /#(\d+)/g;
    let refMatch;
    while ((refMatch = refRegex.exec(args)) !== null) {
      refs.push(parseInt(refMatch[1], 10));
    }

    const entity = { id, type, refs, byteOffset, byteLength };
    entities.push(entity);
    entityMap.set(id, entity);
  }

  // Current pipeline timing (estimated based on actual measurements)
  const indexTimeMs = entities.length * 0.0005; // ~0.5ms per 1000 entities
  const scanTimeMs = entities.length * 0.0003;  // ~0.3ms per 1000 entities

  // Find first geometry entity in current pipeline
  let firstGeometryIndex = -1;
  for (let i = 0; i < entities.length; i++) {
    if (GEOMETRY_ROOTS.has(entities[i].type) || BUILDING_ELEMENTS.has(entities[i].type)) {
      firstGeometryIndex = i;
      break;
    }
  }

  const currentFirstGeometry = indexTimeMs + scanTimeMs +
    (firstGeometryIndex >= 0 ? firstGeometryIndex * 0.0001 : 0); // ~0.1ms per 1000 to reach

  // Streaming pipeline simulation
  const indexed = new Set<number>();
  const queue: EntityInfo[] = [];
  let maxQueueDepth = 0;
  let totalQueued = 0;
  let entitiesBeforeFirstQueue = 0;
  let firstQueuedEntity = -1;
  let firstGeometryProcessedIndex = -1;
  let firstBuildingElementIndex = -1;
  let firstQueueDrained = -1;

  // Simulate streaming: process entities in order
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    indexed.add(entity.id);

    // Skip non-geometry entities for geometry processing
    if (SKIP_FOR_GEOMETRY.has(entity.type)) {
      continue;
    }

    // Check if this entity can be processed immediately
    const geometryRefs = entity.refs.filter(r => {
      const ref = entityMap.get(r);
      return ref && !SKIP_FOR_GEOMETRY.has(ref.type);
    });

    const missingRefs = geometryRefs.filter(r => !indexed.has(r));
    const canProcess = missingRefs.length === 0;

    if (!canProcess) {
      // Need to queue
      if (firstQueuedEntity === -1) {
        firstQueuedEntity = i;
        entitiesBeforeFirstQueue = i;
      }
      queue.push(entity);
      totalQueued++;
      maxQueueDepth = Math.max(maxQueueDepth, queue.length);
    } else {
      // Can process immediately
      if (GEOMETRY_ROOTS.has(entity.type) && firstGeometryProcessedIndex === -1) {
        firstGeometryProcessedIndex = i;
      }
      if (BUILDING_ELEMENTS.has(entity.type) && firstBuildingElementIndex === -1) {
        firstBuildingElementIndex = i;
      }

      // Check if any queued entities can now be processed
      for (let j = queue.length - 1; j >= 0; j--) {
        const queued = queue[j];
        const queuedRefs = queued.refs.filter(r => {
          const ref = entityMap.get(r);
          return ref && !SKIP_FOR_GEOMETRY.has(ref.type);
        });
        const queuedMissing = queuedRefs.filter(r => !indexed.has(r));
        if (queuedMissing.length === 0) {
          queue.splice(j, 1);
          if (queue.length === 0 && firstQueueDrained === -1) {
            firstQueueDrained = i;
          }
        }
      }
    }
  }

  // Calculate streaming timing
  // Assume: scan+index per entity = 0.001ms (combined in streaming)
  const streamingFirstGeometry = firstGeometryProcessedIndex >= 0
    ? firstGeometryProcessedIndex * 0.001 // Time to scan to first processable geometry
    : indexTimeMs + scanTimeMs; // Fallback to current if none found

  const streamingFirstBuildingElement = firstBuildingElementIndex >= 0
    ? firstBuildingElementIndex * 0.001
    : indexTimeMs + scanTimeMs;

  // Count totals
  const buildingElements = entities.filter(e => BUILDING_ELEMENTS.has(e.type)).length;
  const geometryRoots = entities.filter(e => GEOMETRY_ROOTS.has(e.type)).length;

  return {
    fileName,
    fileSize,
    totalEntities: entities.length,
    buildingElements,
    geometryRoots,

    currentPipeline: {
      indexTime: indexTimeMs,
      scanTime: scanTimeMs,
      firstGeometryAt: currentFirstGeometry
    },

    streamingPipeline: {
      firstGeometryAt: streamingFirstGeometry,
      firstBuildingElementAt: streamingFirstBuildingElement,
      entitiesBeforeFirstQueue,
      totalQueued,
      maxQueueDepth,
      queueDrainTime: firstQueueDrained >= 0 ? firstQueueDrained * 0.001 : entities.length * 0.001
    },

    improvement: {
      firstGeometrySpeedup: currentFirstGeometry / Math.max(streamingFirstGeometry, 0.1),
      percentImmediatelyProcessable: ((entities.length - totalQueued) / entities.length) * 100
    }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : [
    'tests/models/ara3d/AC20-FZK-Haus.ifc',
    'tests/models/ara3d/schependomlaan.ifc',
    'tests/models/various/01_BIMcollab_Example_ARC.ifc',
    'tests/models/ara3d/dental_clinic.ifc'
  ];

  console.log('='.repeat(80));
  console.log('STREAMING TIMING SIMULATION');
  console.log('='.repeat(80));
  console.log('');

  const results: StreamingSimulation[] = [];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      continue;
    }

    const fileName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileSize = fs.statSync(filePath).size;

    console.log(`Simulating: ${fileName} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);

    const result = simulateStreaming(content, fileName, fileSize);
    results.push(result);

    console.log(`\n  FILE STATS:`);
    console.log(`    Entities: ${result.totalEntities.toLocaleString()}`);
    console.log(`    Building elements: ${result.buildingElements.toLocaleString()}`);
    console.log(`    Geometry roots: ${result.geometryRoots.toLocaleString()}`);

    console.log(`\n  CURRENT PIPELINE (estimated):`);
    console.log(`    Index time: ${result.currentPipeline.indexTime.toFixed(1)}ms`);
    console.log(`    Scan time: ${result.currentPipeline.scanTime.toFixed(1)}ms`);
    console.log(`    First geometry at: ${result.currentPipeline.firstGeometryAt.toFixed(1)}ms`);

    console.log(`\n  STREAMING PIPELINE (simulated):`);
    console.log(`    First geometry at: ${result.streamingPipeline.firstGeometryAt.toFixed(1)}ms`);
    console.log(`    First building element at: ${result.streamingPipeline.firstBuildingElementAt.toFixed(1)}ms`);
    console.log(`    Entities before first queue: ${result.streamingPipeline.entitiesBeforeFirstQueue.toLocaleString()}`);
    console.log(`    Total queued: ${result.streamingPipeline.totalQueued.toLocaleString()}`);
    console.log(`    Max queue depth: ${result.streamingPipeline.maxQueueDepth.toLocaleString()}`);

    console.log(`\n  📊 IMPROVEMENT:`);
    console.log(`    First geometry speedup: ${result.improvement.firstGeometrySpeedup.toFixed(1)}x`);
    console.log(`    Immediately processable: ${result.improvement.percentImmediatelyProcessable.toFixed(1)}%`);

    console.log('\n' + '-'.repeat(80) + '\n');
  }

  // Summary
  if (results.length > 1) {
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const avgSpeedup = results.reduce((s, r) => s + r.improvement.firstGeometrySpeedup, 0) / results.length;
    const avgProcessable = results.reduce((s, r) => s + r.improvement.percentImmediatelyProcessable, 0) / results.length;

    console.log(`\nAverage first-geometry speedup: ${avgSpeedup.toFixed(1)}x`);
    console.log(`Average immediately processable: ${avgProcessable.toFixed(1)}%`);

    if (avgSpeedup >= 5) {
      console.log('\n✅ RECOMMENDATION: Streaming pipeline is highly beneficial');
    } else if (avgSpeedup >= 2) {
      console.log('\n⚠️  RECOMMENDATION: Streaming pipeline provides moderate benefit');
    } else {
      console.log('\n❌ RECOMMENDATION: Streaming pipeline provides minimal benefit');
    }
  }
}

main().catch(console.error);
