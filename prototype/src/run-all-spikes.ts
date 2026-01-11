/**
 * Run all spike tests
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { runParsingSpike } from './spike1-parsing.js';
import { runTriangulationSpike } from './spike2-triangulation.js';
import { runWebGPUSpike } from './spike3-webgpu.js';
import { runQuerySpike as runQuerySpike4 } from './spike4-query.js';
import { runColumnarSpike } from './spike5-columnar.js';
import { runQuerySpike as runQuerySpike6 } from './spike6-query.js';
import { runBVHSpike } from './spike7-bvh.js';
import { runGLTFSpike } from './spike8-gltf.js';
import { runSQLSpike } from './spike9-sql.js';
import { IfcParser } from '@ifc-lite/parser';
import type { IfcDataStore } from '@ifc-lite/parser';

// Create a File-like object from a buffer for Node.js
function createFileFromBuffer(buffer: Buffer, filename: string): File {
  // Polyfill File for Node.js
  if (typeof File === 'undefined') {
    // @ts-ignore - Creating File polyfill
    global.File = class File extends Blob {
      name: string;
      lastModified: number;
      
      constructor(parts: any[], options: any) {
        super(parts, options);
        this.name = options?.name || '';
        this.lastModified = options?.lastModified || Date.now();
      }
    };
  }
  
  return new File([buffer], filename, {
    lastModified: Date.now(),
  });
}

// Helper to format results
function formatResult(spikeName: string, result: any, passed: boolean): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${spikeName}: ${passed ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('='.repeat(60));
  
  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }
  
  // Format based on spike type
  if ('throughputMBps' in result) {
    // Spike 1: Parsing
    console.log(`  File Size: ${result.fileSizeMB.toFixed(2)} MB`);
    console.log(`  Scan Time: ${result.scanTimeMs.toFixed(2)} ms`);
    console.log(`  Throughput: ${result.throughputMBps.toFixed(2)} MB/s`);
    console.log(`  Target: >${result.targetMBps} MB/s`);
    console.log(`  Entity Count: ${result.entityCount.toLocaleString()}`);
  } else if ('coveragePercent' in result) {
    // Spike 2: Triangulation
    console.log(`  Coverage: ${result.coveragePercent.toFixed(1)}%`);
    console.log(`  Target: ≥${result.targetCoverage}%`);
    console.log(`  Success: ${result.successCount.toLocaleString()}`);
    console.log(`  Failed: ${result.failedCount.toLocaleString()}`);
    console.log(`  Total: ${result.totalCount.toLocaleString()}`);
  } else if ('fps' in result) {
    // Spike 3: WebGPU
    console.log(`  Renderer: ${result.renderer.toUpperCase()}`);
    console.log(`  Frame Time: ${result.frameTimeMs.toFixed(2)} ms`);
    console.log(`  FPS: ${result.fps.toFixed(1)}`);
    console.log(`  Target: <${result.targetMs} ms`);
    console.log(`  Triangles: ${result.triangleCount.toLocaleString()}`);
  } else if ('queryTimeMs' in result && 'entityCount' in result && 'propertyCount' in result) {
    // Spike 4: Query (old)
    console.log(`  Query Time: ${result.queryTimeMs.toFixed(2)} ms`);
    console.log(`  Target: <${result.targetMs} ms`);
    console.log(`  Entities: ${result.entityCount.toLocaleString()}`);
    console.log(`  Properties: ${result.propertyCount.toLocaleString()}`);
    console.log(`  Results: ${result.resultCount.toLocaleString()}`);
  } else if ('memorySavingsPercent' in result) {
    // Spike 5: Columnar
    console.log(`  Map Memory: ${result.mapMemoryMB.toFixed(2)} MB`);
    console.log(`  Columnar Memory: ${result.columnarMemoryMB.toFixed(2)} MB`);
    console.log(`  Memory Savings: ${result.memorySavingsPercent.toFixed(1)}%`);
    console.log(`  Map Query Time: ${result.mapQueryTimeMs.toFixed(3)} ms`);
    console.log(`  Columnar Query Time: ${result.columnarQueryTimeMs.toFixed(3)} ms`);
    console.log(`  Query Speedup: ${result.querySpeedup.toFixed(2)}x`);
    console.log(`  String Dedup Ratio: ${result.stringDedupRatio.toFixed(2)}`);
    console.log(`  Entity Count: ${result.entityCount.toLocaleString()}`);
  } else if ('typeShortcutsWork' in result) {
    // Spike 6: Query (new)
    console.log(`  Type Shortcuts: ${result.typeShortcutsWork ? '✅' : '❌'}`);
    console.log(`  Property Filters: ${result.propertyFiltersWork ? '✅' : '❌'}`);
    console.log(`  Graph Traversal: ${result.graphTraversalWorks ? '✅' : '❌'}`);
    console.log(`  Query Time: ${result.queryTimeMs.toFixed(2)} ms`);
    console.log(`  Result Count: ${result.resultCount.toLocaleString()}`);
  } else if ('speedup' in result) {
    // Spike 7: BVH
    console.log(`  Mesh Count: ${result.meshCount.toLocaleString()}`);
    console.log(`  BVH Build Time: ${result.bvhBuildTimeMs.toFixed(2)} ms`);
    console.log(`  Linear Query Time: ${result.linearQueryTimeMs.toFixed(2)} ms`);
    console.log(`  BVH Query Time: ${result.bvhQueryTimeMs.toFixed(2)} ms`);
    console.log(`  Speedup: ${result.speedup.toFixed(2)}x`);
    console.log(`  Query Results: ${result.queryResultCount.toLocaleString()}`);
  } else if ('glbSizeBytes' in result) {
    // Spike 8: glTF
    console.log(`  GLB Size: ${(result.glbSizeBytes / 1024).toFixed(2)} KB`);
    console.log(`  Mesh Count: ${result.meshCount.toLocaleString()}`);
    console.log(`  Vertex Count: ${result.vertexCount.toLocaleString()}`);
    console.log(`  Triangle Count: ${result.triangleCount.toLocaleString()}`);
    console.log(`  Export Time: ${result.exportTimeMs.toFixed(2)} ms`);
  } else if ('duckdbAvailable' in result) {
    // Spike 9: SQL
    console.log(`  DuckDB Available: ${result.duckdbAvailable ? '✅' : '❌'}`);
    console.log(`  Init Time: ${result.initTimeMs.toFixed(2)} ms`);
    console.log(`  Query Time: ${result.queryTimeMs.toFixed(2)} ms`);
    console.log(`  Result Count: ${result.resultCount.toLocaleString()}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }
}

async function runAllSpikes(ifcFilePath?: string) {
  console.log('🚀 Running All Spike Tests\n');
  
  const results: Array<{ name: string; passed: boolean; error?: string }> = [];
  
  // Find IFC file
  let ifcFile: File | null = null;
  if (ifcFilePath) {
    try {
      // Resolve relative paths from current working directory
      const resolvedPath = ifcFilePath.startsWith('/') 
        ? ifcFilePath 
        : join(process.cwd(), ifcFilePath);
      const buffer = readFileSync(resolvedPath);
      ifcFile = createFileFromBuffer(buffer, resolvedPath.split('/').pop() || 'test.ifc');
      console.log(`📁 Using IFC file: ${resolvedPath}`);
    } catch (error) {
      console.warn(`⚠️  Could not read IFC file: ${ifcFilePath}`);
      console.warn(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    // Try to find default IFC file
    // prototype is at ifc-lite/prototype, so go up one level to find .ifc files
    const defaultPaths = [
      join(process.cwd(), '..', '01_Snowdon_Towers_Sample_Structural(1).ifc'),
      join(process.cwd(), '..', '..', '01_Snowdon_Towers_Sample_Structural(1).ifc'),
      join(process.cwd(), '01_Snowdon_Towers_Sample_Structural(1).ifc'),
    ];
    
    for (const path of defaultPaths) {
      try {
        const buffer = readFileSync(path);
        ifcFile = createFileFromBuffer(buffer, path.split('/').pop() || 'test.ifc');
        console.log(`📁 Found IFC file: ${path}`);
        break;
      } catch (err) {
        // Try next path
      }
    }
  }
  
  if (!ifcFile) {
    console.warn('⚠️  No IFC file found. Some spikes will be skipped.');
  }
  
  // Parse IFC file for SQL spike (if available)
  let ifcDataStore: IfcDataStore | null = null;
  if (ifcFile) {
    try {
      console.log('\n📊 Parsing IFC file for SQL spike...');
      const buffer = await ifcFile.arrayBuffer();
      const parser = new IfcParser();
      ifcDataStore = await parser.parseColumnar(buffer);
      console.log(`   Parsed ${ifcDataStore.entityCount} entities`);
    } catch (error) {
      console.warn(`   Could not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Spike 1: Parsing
  if (ifcFile) {
    try {
      console.log('\n📊 Running Spike 1: Parsing Speed...');
      const result = await runParsingSpike(ifcFile);
      formatResult('Spike 1: Parsing Speed', result, result.passed);
      results.push({ name: 'Spike 1: Parsing', passed: result.passed });
    } catch (error) {
      console.error(`❌ Spike 1 failed: ${error}`);
      results.push({ name: 'Spike 1: Parsing', passed: false, error: String(error) });
    }
  } else {
    console.log('\n⏭️  Skipping Spike 1: Parsing Speed (no IFC file)');
    results.push({ name: 'Spike 1: Parsing', passed: false, error: 'No IFC file' });
  }
  
  // Spike 2: Triangulation
  if (ifcFile) {
    try {
      console.log('\n📊 Running Spike 2: Triangulation...');
      const result = await runTriangulationSpike(ifcFile);
      formatResult('Spike 2: Triangulation', result, result.passed);
      results.push({ name: 'Spike 2: Triangulation', passed: result.passed });
    } catch (error) {
      console.error(`❌ Spike 2 failed: ${error}`);
      results.push({ name: 'Spike 2: Triangulation', passed: false, error: String(error) });
    }
  } else {
    console.log('\n⏭️  Skipping Spike 2: Triangulation (no IFC file)');
    results.push({ name: 'Spike 2: Triangulation', passed: false, error: 'No IFC file' });
  }
  
  // Spike 3: WebGPU (requires DOM, skip in Node.js)
  console.log('\n⏭️  Skipping Spike 3: WebGPU (requires browser environment)');
  results.push({ name: 'Spike 3: WebGPU', passed: false, error: 'Requires browser environment' });
  
  // Spike 4: Query (old)
  try {
    console.log('\n📊 Running Spike 4: Query (old)...');
    const result = runQuerySpike4();
    formatResult('Spike 4: Query (old)', result, result.passed);
    results.push({ name: 'Spike 4: Query (old)', passed: result.passed });
  } catch (error) {
    console.error(`❌ Spike 4 failed: ${error}`);
    results.push({ name: 'Spike 4: Query (old)', passed: false, error: String(error) });
  }
  
  // Spike 5: Columnar
  if (ifcFile) {
    try {
      console.log('\n📊 Running Spike 5: Columnar Data Structures...');
      const result = await runColumnarSpike(ifcFile);
      formatResult('Spike 5: Columnar Data Structures', result, result.passed);
      results.push({ name: 'Spike 5: Columnar', passed: result.passed });
    } catch (error) {
      console.error(`❌ Spike 5 failed: ${error}`);
      results.push({ name: 'Spike 5: Columnar', passed: false, error: String(error) });
    }
  } else {
    console.log('\n⏭️  Skipping Spike 5: Columnar (no IFC file)');
    results.push({ name: 'Spike 5: Columnar', passed: false, error: 'No IFC file' });
  }
  
  // Spike 6: Query (new)
  if (ifcFile) {
    try {
      console.log('\n📊 Running Spike 6: Enhanced Query System...');
      const result = await runQuerySpike6(ifcFile);
      formatResult('Spike 6: Enhanced Query System', result, result.passed);
      results.push({ name: 'Spike 6: Query (new)', passed: result.passed });
    } catch (error) {
      console.error(`❌ Spike 6 failed: ${error}`);
      results.push({ name: 'Spike 6: Query (new)', passed: false, error: String(error) });
    }
  } else {
    console.log('\n⏭️  Skipping Spike 6: Enhanced Query (no IFC file)');
    results.push({ name: 'Spike 6: Query (new)', passed: false, error: 'No IFC file' });
  }
  
  // Spike 7: BVH
  if (ifcFile) {
    try {
      console.log('\n📊 Running Spike 7: BVH Spatial Index...');
      const result = await runBVHSpike(ifcFile);
      formatResult('Spike 7: BVH Spatial Index', result, result.passed);
      results.push({ name: 'Spike 7: BVH', passed: result.passed });
    } catch (error) {
      console.error(`❌ Spike 7 failed: ${error}`);
      results.push({ name: 'Spike 7: BVH', passed: false, error: String(error) });
    }
  } else {
    console.log('\n⏭️  Skipping Spike 7: BVH (no IFC file)');
    results.push({ name: 'Spike 7: BVH', passed: false, error: 'No IFC file' });
  }
  
  // Spike 8: glTF
  if (ifcFile) {
    try {
      console.log('\n📊 Running Spike 8: glTF Export...');
      const result = await runGLTFSpike(ifcFile);
      formatResult('Spike 8: glTF Export', result, result.passed);
      results.push({ name: 'Spike 8: glTF', passed: result.passed });
    } catch (error) {
      console.error(`❌ Spike 8 failed: ${error}`);
      results.push({ name: 'Spike 8: glTF', passed: false, error: String(error) });
    }
  } else {
    console.log('\n⏭️  Skipping Spike 8: glTF (no IFC file)');
    results.push({ name: 'Spike 8: glTF', passed: false, error: 'No IFC file' });
  }
  
  // Spike 9: SQL
  try {
    console.log('\n📊 Running Spike 9: SQL Integration...');
    const result = await runSQLSpike(ifcDataStore);
    formatResult('Spike 9: SQL Integration', result, result.passed);
    results.push({ name: 'Spike 9: SQL', passed: result.passed });
  } catch (error) {
    console.error(`❌ Spike 9 failed: ${error}`);
    results.push({ name: 'Spike 9: SQL', passed: false, error: String(error) });
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`${icon} ${r.name}${r.error ? ` (${r.error})` : ''}`);
  });
  
  console.log(`\n✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run if called directly
const ifcFile = process.argv[2];
runAllSpikes(ifcFile).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
