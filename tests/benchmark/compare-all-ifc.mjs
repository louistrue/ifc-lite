#!/usr/bin/env node
/**
 * Comprehensive IFC4 Geometry Comparison: ifc-lite vs web-ifc
 * Runs all IFC files (except IFC5) in parallel and generates a summary report
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';
import { createRequire } from 'module';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { fileURLToPath } from 'url';
import { cpus } from 'os';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

// Configuration
const TEST_DIR = 'tests/models';
const EXCLUDE_DIRS = ['ifc5']; // Exclude IFC5 files
const MAX_FILE_SIZE_MB = 50; // Skip files larger than this
const PARALLEL_WORKERS = Math.min(cpus().length, 6); // Limit parallelism

// Find all IFC files recursively
function findIfcFiles(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) {
        findIfcFiles(fullPath, files);
      }
    } else if (entry.name.endsWith('.ifc')) {
      const stats = statSync(fullPath);
      const sizeMB = stats.size / 1024 / 1024;
      if (sizeMB <= MAX_FILE_SIZE_MB) {
        files.push({ path: fullPath, sizeMB });
      }
    }
  }
  return files;
}

// Process a single IFC file
async function processFile(filePath) {
  const result = {
    file: relative(process.cwd(), filePath),
    sizeMB: 0,
    ifcLite: null,
    webIfc: null,
    error: null
  };

  try {
    const ifcData = readFileSync(filePath);
    const ifcString = ifcData.toString('utf8');
    result.sizeMB = ifcData.length / 1024 / 1024;

    // Check if it's IFC5/IFCX (skip)
    if (ifcString.includes('FILE_SCHEMA((\'IFC5') || ifcString.includes('FILE_SCHEMA((\'IFCX')) {
      result.error = 'IFC5/IFCX (skipped)';
      return result;
    }

    // IFC-LITE
    try {
      const wasmModule = await import('../../packages/wasm/pkg/ifc_lite_wasm.js');
      const wasmBuffer = readFileSync('./packages/wasm/pkg/ifc_lite_wasm_bg.wasm');
      await wasmModule.default(wasmBuffer);

      const ifcLite = new wasmModule.IfcAPI();
      const liteStart = performance.now();
      const meshes = ifcLite.parseMeshes(ifcString);
      const liteTime = performance.now() - liteStart;

      let totalVerts = 0, totalTris = 0;
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes.get(i);
        totalVerts += mesh.vertexCount;
        totalTris += mesh.triangleCount;
      }

      result.ifcLite = {
        meshes: meshes.length,
        vertices: totalVerts,
        triangles: totalTris,
        timeMs: liteTime
      };
    } catch (err) {
      result.ifcLite = { error: err.message };
    }

    // WEB-IFC
    try {
      const WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');
      const webIfc = new WebIFC.IfcAPI();
      await webIfc.Init();

      const webStart = performance.now();
      const modelId = webIfc.OpenModel(ifcData);

      let webVerts = 0, webTris = 0, webMeshes = 0;
      webIfc.StreamAllMeshes(modelId, (mesh) => {
        const placedGeometries = mesh.geometries;
        for (let i = 0; i < placedGeometries.size(); i++) {
          const placed = placedGeometries.get(i);
          const geom = webIfc.GetGeometry(modelId, placed.geometryExpressID);
          const verts = webIfc.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const indices = webIfc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          webVerts += verts.length / 6;
          webTris += indices.length / 3;
          webMeshes++;
          geom.delete();
        }
      });
      const webTime = performance.now() - webStart;
      webIfc.CloseModel(modelId);

      result.webIfc = {
        meshes: webMeshes,
        vertices: webVerts,
        triangles: webTris,
        timeMs: webTime
      };
    } catch (err) {
      result.webIfc = { error: err.message };
    }

  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// Format number with commas
function fmt(n) {
  if (n === undefined || n === null) return '-';
  return Math.round(n).toLocaleString();
}

// Calculate ratio as percentage
function ratio(a, b) {
  if (!b || b === 0) return '-';
  return ((a / b) * 100).toFixed(1) + '%';
}

// Status indicator
function status(lite, web) {
  if (!lite || !web || lite.error || web.error) return '⚠️';
  const triRatio = lite.triangles / web.triangles;
  if (triRatio >= 0.95 && triRatio <= 1.05) return '✅';
  if (triRatio >= 0.80 && triRatio <= 1.20) return '🟡';
  return '❌';
}

// Main execution
async function main() {
  console.log('═'.repeat(100));
  console.log('  IFC GEOMETRY COMPARISON: ifc-lite vs web-ifc');
  console.log('═'.repeat(100));
  console.log(`\n  Workers: ${PARALLEL_WORKERS} | Max file size: ${MAX_FILE_SIZE_MB}MB | Excluding: ${EXCLUDE_DIRS.join(', ')}\n`);

  // Find files
  const files = findIfcFiles(TEST_DIR);
  console.log(`  Found ${files.length} IFC files to process\n`);

  // Sort by size (smallest first for faster initial results)
  files.sort((a, b) => a.sizeMB - b.sizeMB);

  // Process files sequentially (workers have issues with WASM in Node)
  const results = [];
  let processed = 0;

  for (const file of files) {
    processed++;
    const shortName = basename(file.path).slice(0, 40);
    process.stdout.write(`  [${processed}/${files.length}] ${shortName.padEnd(42)} `);

    const result = await processFile(file.path);
    results.push(result);

    // Quick status
    if (result.error) {
      console.log(`⚠️  ${result.error}`);
    } else if (result.ifcLite?.error || result.webIfc?.error) {
      console.log(`⚠️  Parse error`);
    } else {
      const triRatio = ratio(result.ifcLite?.triangles, result.webIfc?.triangles);
      console.log(`${status(result.ifcLite, result.webIfc)} ${triRatio}`);
    }
  }

  // Generate summary report
  console.log('\n' + '═'.repeat(100));
  console.log('  DETAILED RESULTS');
  console.log('═'.repeat(100));

  // Table header
  console.log('\n' + [
    'Status',
    'File'.padEnd(45),
    'Size'.padStart(8),
    'Lite Tri'.padStart(12),
    'Web Tri'.padStart(12),
    'Ratio'.padStart(8),
    'Lite ms'.padStart(10),
    'Web ms'.padStart(10)
  ].join(' │ '));
  console.log('─'.repeat(120));

  // Sort results by ratio for easy scanning
  const sortedResults = [...results].sort((a, b) => {
    const ratioA = a.ifcLite?.triangles && a.webIfc?.triangles
      ? a.ifcLite.triangles / a.webIfc.triangles : 0;
    const ratioB = b.ifcLite?.triangles && b.webIfc?.triangles
      ? b.ifcLite.triangles / b.webIfc.triangles : 0;
    return ratioA - ratioB;
  });

  for (const r of sortedResults) {
    const fileName = basename(r.file).slice(0, 43);
    const size = r.sizeMB.toFixed(1) + 'MB';
    const liteTri = r.ifcLite?.error ? 'ERR' : fmt(r.ifcLite?.triangles);
    const webTri = r.webIfc?.error ? 'ERR' : fmt(r.webIfc?.triangles);
    const triRatio = ratio(r.ifcLite?.triangles, r.webIfc?.triangles);
    const liteTime = r.ifcLite?.timeMs ? r.ifcLite.timeMs.toFixed(0) + 'ms' : '-';
    const webTime = r.webIfc?.timeMs ? r.webIfc.timeMs.toFixed(0) + 'ms' : '-';

    console.log([
      status(r.ifcLite, r.webIfc).padEnd(6),
      fileName.padEnd(45),
      size.padStart(8),
      liteTri.padStart(12),
      webTri.padStart(12),
      triRatio.padStart(8),
      liteTime.padStart(10),
      webTime.padStart(10)
    ].join(' │ '));
  }

  // Summary statistics
  console.log('\n' + '═'.repeat(100));
  console.log('  SUMMARY');
  console.log('═'.repeat(100));

  const valid = results.filter(r => r.ifcLite && r.webIfc && !r.ifcLite.error && !r.webIfc.error);
  const excellent = valid.filter(r => {
    const ratio = r.ifcLite.triangles / r.webIfc.triangles;
    return ratio >= 0.95 && ratio <= 1.05;
  });
  const good = valid.filter(r => {
    const ratio = r.ifcLite.triangles / r.webIfc.triangles;
    return ratio >= 0.80 && ratio <= 1.20;
  });
  const problematic = valid.filter(r => {
    const ratio = r.ifcLite.triangles / r.webIfc.triangles;
    return ratio < 0.80 || ratio > 1.20;
  });

  const totalLiteTri = valid.reduce((sum, r) => sum + (r.ifcLite?.triangles || 0), 0);
  const totalWebTri = valid.reduce((sum, r) => sum + (r.webIfc?.triangles || 0), 0);
  const totalLiteTime = valid.reduce((sum, r) => sum + (r.ifcLite?.timeMs || 0), 0);
  const totalWebTime = valid.reduce((sum, r) => sum + (r.webIfc?.timeMs || 0), 0);

  console.log(`
  Total files tested:     ${results.length}
  Successfully compared:  ${valid.length}

  ✅ Excellent (95-105%): ${excellent.length} files
  🟡 Good (80-120%):      ${good.length} files
  ❌ Needs attention:     ${problematic.length} files
  ⚠️  Errors/skipped:      ${results.length - valid.length} files

  Total triangles:
    ifc-lite: ${fmt(totalLiteTri)}
    web-ifc:  ${fmt(totalWebTri)}
    ratio:    ${ratio(totalLiteTri, totalWebTri)}

  Total processing time:
    ifc-lite: ${(totalLiteTime / 1000).toFixed(2)}s
    web-ifc:  ${(totalWebTime / 1000).toFixed(2)}s
    speedup:  ${(totalWebTime / totalLiteTime).toFixed(2)}x faster
`);

  // List problematic files
  if (problematic.length > 0) {
    console.log('  ❌ FILES NEEDING ATTENTION:');
    console.log('  ' + '─'.repeat(60));
    for (const r of problematic) {
      const triRatio = ratio(r.ifcLite?.triangles, r.webIfc?.triangles);
      console.log(`    ${basename(r.file)} - ${triRatio}`);
    }
    console.log();
  }

  console.log('═'.repeat(100));
}

main().catch(console.error);
