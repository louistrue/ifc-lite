/**
 * IFC-LITE vs WEB-IFC Comprehensive Benchmark Suite
 *
 * Tests:
 * 1. Performance: Parsing speed, geometry extraction, throughput
 * 2. Correctness: Entity counts, geometry output validation
 * 3. Coverage: What types of IFC entities each parser handles
 */
const fs = require('fs');
const path = require('path');

// Configuration
const WARMUP_RUNS = 1;
const BENCHMARK_RUNS = 3;
const SKIP_LARGE_FILES_THRESHOLD = 100 * 1024 * 1024; // 100MB (include large models)

// Load libraries
let IfcLiteAPI, WebIFC;

async function loadLibraries() {
  try {
    const ifcLiteModule = require('../../packages/wasm/ifc_lite_wasm');
    IfcLiteAPI = ifcLiteModule.IfcAPI;
    console.log('✓ IFC-Lite loaded');
  } catch (e) {
    console.error('✗ Failed to load IFC-Lite:', e.message);
    process.exit(1);
  }

  try {
    // Try to load web-ifc from various locations
    const webIfcPaths = [
      'web-ifc',
      '/tmp/web-ifc-test/node_modules/web-ifc',
      path.join(__dirname, '../../node_modules/web-ifc'),
    ];

    for (const p of webIfcPaths) {
      try {
        WebIFC = require(p);
        console.log(`✓ web-ifc loaded from ${p}`);
        break;
      } catch {}
    }

    if (!WebIFC) {
      throw new Error('web-ifc not found in any known location');
    }
  } catch (e) {
    console.error('✗ Failed to load web-ifc:', e.message);
    console.log('\nInstalling web-ifc...');
    const { execSync } = require('child_process');
    try {
      execSync('mkdir -p /tmp/web-ifc-test && cd /tmp/web-ifc-test && npm init -y && npm install web-ifc', { stdio: 'inherit' });
      WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');
      console.log('✓ web-ifc installed and loaded');
    } catch (installError) {
      console.error('✗ Failed to install web-ifc:', installError.message);
      process.exit(1);
    }
  }
}

// Collect all IFC test files (recursively searches subdirectories)
function collectTestFiles() {
  const testDirs = [
    path.join(__dirname, '../ifc'),
    path.join(__dirname, '../ifc/ara3d-format-shootout'),
    path.join(__dirname, '../ifc/buildingSMART-PCERT-Sample-Scene'),
    path.join(__dirname, '../ifc/generated'),
    path.join(__dirname, 'models/buildingsmart'),
    path.join(__dirname, 'models/ara3d'),
  ];

  const files = [];

  for (const dir of testDirs) {
    if (!fs.existsSync(dir)) continue;

    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.ifc') && !entry.endsWith('.IFC')) continue;

      const filePath = path.join(dir, entry);
      const stats = fs.statSync(filePath);

      // Skip LFS pointer files (typically ~130 bytes)
      if (stats.size < 1000) {
        console.log(`  Skipping ${entry} (LFS pointer or too small)`);
        continue;
      }

      // Skip very large files
      if (stats.size > SKIP_LARGE_FILES_THRESHOLD) {
        console.log(`  Skipping ${entry} (too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
        continue;
      }

      files.push({
        name: entry,
        path: filePath,
        size: stats.size,
        category: path.basename(dir),
      });
    }
  }

  // Sort by size for better progress visibility
  return files.sort((a, b) => a.size - b.size);
}

// Run IFC-Lite benchmark
function benchmarkIfcLite(ifcData, ifcString) {
  const api = new IfcLiteAPI();

  // Warmup
  for (let i = 0; i < WARMUP_RUNS; i++) {
    api.parseZeroCopy(ifcString);
  }

  // Timed runs
  const times = [];
  let result = null;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    const start = performance.now();
    result = api.parseZeroCopy(ifcString);
    const end = performance.now();
    times.push(end - start);
  }

  const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
  const minTime = Math.min(...times);

  return {
    time: avgTime,
    minTime: minTime,
    vertices: result.positions_len / 3,
    triangles: result.indices_len / 3,
    throughput: (ifcData.length / 1024 / 1024) / (avgTime / 1000),
  };
}

// Run web-ifc benchmark
async function benchmarkWebIfc(webIfc, ifcData) {
  // Warmup
  for (let i = 0; i < WARMUP_RUNS; i++) {
    const modelID = webIfc.OpenModel(ifcData);
    webIfc.CloseModel(modelID);
  }

  // Timed runs
  const parseTimes = [];
  const geoTimes = [];
  let vertices = 0;
  let triangles = 0;
  let elements = 0;

  for (let i = 0; i < BENCHMARK_RUNS; i++) {
    // Parse timing
    const parseStart = performance.now();
    const modelID = webIfc.OpenModel(ifcData);
    const parseEnd = performance.now();
    parseTimes.push(parseEnd - parseStart);

    // Geometry extraction timing
    const geoStart = performance.now();
    let runVertices = 0;
    let runTriangles = 0;
    let runElements = 0;

    webIfc.StreamAllMeshes(modelID, (mesh) => {
      runElements++;
      const placedGeometries = mesh.geometries;
      for (let j = 0; j < placedGeometries.size(); j++) {
        const placedGeometry = placedGeometries.get(j);
        const geometry = webIfc.GetGeometry(modelID, placedGeometry.geometryExpressID);
        const verts = webIfc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = webIfc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        runVertices += verts.length / 6; // web-ifc interleaves position + normal
        runTriangles += indices.length / 3;
        geometry.delete();
      }
    });

    const geoEnd = performance.now();
    geoTimes.push(geoEnd - geoStart);

    // Keep last run's counts
    vertices = runVertices;
    triangles = runTriangles;
    elements = runElements;

    webIfc.CloseModel(modelID);
  }

  const avgParseTime = parseTimes.reduce((a, b) => a + b, 0) / parseTimes.length;
  const avgGeoTime = geoTimes.reduce((a, b) => a + b, 0) / geoTimes.length;
  const avgTotalTime = avgParseTime + avgGeoTime;
  const minTotalTime = Math.min(...parseTimes.map((p, i) => p + geoTimes[i]));

  return {
    parseTime: avgParseTime,
    geoTime: avgGeoTime,
    time: avgTotalTime,
    minTime: minTotalTime,
    vertices: vertices,
    triangles: triangles,
    elements: elements,
    throughput: (ifcData.length / 1024 / 1024) / (avgTotalTime / 1000),
  };
}

// Qualitative test: Check entity counts match
function countEntities(ifcString) {
  const entityPattern = /#\d+\s*=\s*(\w+)\s*\(/g;
  const counts = {};
  let match;

  while ((match = entityPattern.exec(ifcString)) !== null) {
    const type = match[1].toUpperCase();
    counts[type] = (counts[type] || 0) + 1;
  }

  return counts;
}

// Analyze geometry types in file
function analyzeGeometryTypes(ifcString) {
  const types = {
    extrusion: 0,
    brep: 0,
    tessellation: 0,
    mappedItem: 0,
    booleanResult: 0,
    other: 0,
  };

  const patterns = {
    extrusion: /IFCEXTRUDEDAREASOLID/gi,
    brep: /IFCFACETEDBREP|IFCADVANCEDBREP/gi,
    tessellation: /IFCTRIANGULATEDFACESET|IFCPOLYGONALFACE/gi,
    mappedItem: /IFCMAPPEDITEM/gi,
    booleanResult: /IFCBOOLEANRESULT|IFCBOOLEANCLIPPINGRESULT/gi,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const matches = ifcString.match(pattern);
    types[key] = matches ? matches.length : 0;
  }

  return types;
}

// Format number with thousands separator
function fmt(n) {
  return Math.round(n).toLocaleString();
}

// Main benchmark runner
async function runBenchmark() {
  console.log('═'.repeat(80));
  console.log('  IFC-LITE vs WEB-IFC COMPREHENSIVE BENCHMARK SUITE');
  console.log('═'.repeat(80));
  console.log(`  Date: ${new Date().toISOString()}`);
  console.log(`  Warmup runs: ${WARMUP_RUNS}, Benchmark runs: ${BENCHMARK_RUNS}`);
  console.log('═'.repeat(80));
  console.log('');

  await loadLibraries();
  console.log('');

  // Initialize web-ifc
  const webIfc = new WebIFC.IfcAPI();
  await webIfc.Init();
  console.log('✓ web-ifc initialized\n');

  // Collect test files
  console.log('Collecting test files...');
  const testFiles = collectTestFiles();
  console.log(`Found ${testFiles.length} test files\n`);

  if (testFiles.length === 0) {
    console.error('No test files found!');
    process.exit(1);
  }

  // Results storage
  const results = [];
  const qualitativeResults = [];

  // Run benchmarks
  console.log('─'.repeat(80));
  console.log('RUNNING BENCHMARKS');
  console.log('─'.repeat(80));
  console.log('');

  for (let i = 0; i < testFiles.length; i++) {
    const file = testFiles[i];
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);

    console.log(`[${i + 1}/${testFiles.length}] ${file.name} (${sizeMB} MB) [${file.category}]`);

    try {
      const ifcData = fs.readFileSync(file.path);
      const ifcString = ifcData.toString('utf8');

      // Analyze file
      const entityCounts = countEntities(ifcString);
      const geoTypes = analyzeGeometryTypes(ifcString);
      const totalEntities = Object.values(entityCounts).reduce((a, b) => a + b, 0);

      // Run IFC-Lite benchmark
      let ifcLiteResult;
      try {
        ifcLiteResult = benchmarkIfcLite(ifcData, ifcString);
        console.log(`    IFC-Lite: ${ifcLiteResult.time.toFixed(1)}ms, ${fmt(ifcLiteResult.vertices)} verts, ${fmt(ifcLiteResult.triangles)} tris`);
      } catch (e) {
        console.log(`    IFC-Lite: ERROR - ${e.message}`);
        ifcLiteResult = { time: Infinity, vertices: 0, triangles: 0, throughput: 0, error: e.message };
      }

      // Run web-ifc benchmark
      let webIfcResult;
      try {
        webIfcResult = await benchmarkWebIfc(webIfc, ifcData);
        console.log(`    web-ifc:  ${webIfcResult.time.toFixed(1)}ms, ${fmt(webIfcResult.vertices)} verts, ${fmt(webIfcResult.triangles)} tris`);
      } catch (e) {
        console.log(`    web-ifc:  ERROR - ${e.message}`);
        webIfcResult = { time: Infinity, vertices: 0, triangles: 0, throughput: 0, elements: 0, error: e.message };
      }

      // Calculate speedup
      const speedup = webIfcResult.time / ifcLiteResult.time;
      const speedupStr = isFinite(speedup) ? `${speedup.toFixed(2)}x` : 'N/A';
      const winner = speedup > 1 ? 'IFC-Lite' : 'web-ifc';
      console.log(`    Speedup: ${speedupStr} (${winner} faster)`);

      // Store results
      results.push({
        file: file.name,
        category: file.category,
        sizeMB: parseFloat(sizeMB),
        totalEntities,
        geoTypes,
        ifcLite: ifcLiteResult,
        webIfc: webIfcResult,
        speedup: isFinite(speedup) ? speedup : null,
      });

      // Qualitative check: geometry output comparison
      if (!ifcLiteResult.error && !webIfcResult.error) {
        // Guard against division by zero
        const vertexRatio = webIfcResult.vertices > 0 ? ifcLiteResult.vertices / webIfcResult.vertices : null;
        const triangleRatio = webIfcResult.triangles > 0 ? ifcLiteResult.triangles / webIfcResult.triangles : null;

        qualitativeResults.push({
          file: file.name,
          vertexRatio,
          triangleRatio,
          vertexDiff: ifcLiteResult.vertices - webIfcResult.vertices,
          triangleDiff: ifcLiteResult.triangles - webIfcResult.triangles,
          hasGeometry: ifcLiteResult.triangles > 0 && webIfcResult.triangles > 0,
        });
      }

      console.log('');
    } catch (e) {
      console.log(`    ERROR: ${e.message}\n`);
      results.push({
        file: file.name,
        category: file.category,
        sizeMB: parseFloat((file.size / 1024 / 1024).toFixed(2)),
        error: e.message,
      });
    }
  }

  // Generate summary report
  console.log('═'.repeat(80));
  console.log('  BENCHMARK RESULTS SUMMARY');
  console.log('═'.repeat(80));
  console.log('');

  // Performance summary
  const successfulResults = results.filter(r => r.ifcLite && r.webIfc && !r.ifcLite.error && !r.webIfc.error);

  if (successfulResults.length > 0) {
    console.log('─'.repeat(80));
    console.log('PERFORMANCE COMPARISON');
    console.log('─'.repeat(80));
    console.log('');

    // Table header
    console.log('File'.padEnd(45) + 'Size(MB)'.padStart(10) + 'IFC-Lite'.padStart(12) + 'web-ifc'.padStart(12) + 'Speedup'.padStart(10));
    console.log('─'.repeat(89));

    for (const r of successfulResults) {
      const name = r.file.length > 42 ? r.file.substring(0, 42) + '...' : r.file;
      const liteTime = r.ifcLite.time.toFixed(0) + 'ms';
      const webTime = r.webIfc.time.toFixed(0) + 'ms';
      const speedup = r.speedup ? `${r.speedup.toFixed(2)}x` : 'N/A';
      console.log(name.padEnd(45) + r.sizeMB.toFixed(2).padStart(10) + liteTime.padStart(12) + webTime.padStart(12) + speedup.padStart(10));
    }

    // Overall statistics
    const speedups = successfulResults.map(r => r.speedup).filter(Boolean).sort((a, b) => a - b);
    const avgSpeedup = speedups.length > 0 ? speedups.reduce((a, b) => a + b, 0) / speedups.length : null;
    const medianSpeedup = speedups.length > 0 ? speedups[Math.floor(speedups.length / 2)] : null;
    const totalIfcLiteTime = successfulResults.reduce((a, r) => a + r.ifcLite.time, 0);
    const totalWebIfcTime = successfulResults.reduce((a, r) => a + r.webIfc.time, 0);

    console.log('─'.repeat(89));
    console.log('');
    console.log(`Total files benchmarked: ${successfulResults.length}`);
    console.log(`Average speedup: ${avgSpeedup.toFixed(2)}x`);
    console.log(`Median speedup: ${medianSpeedup?.toFixed(2) || 'N/A'}x`);
    console.log(`Total time - IFC-Lite: ${(totalIfcLiteTime/1000).toFixed(2)}s, web-ifc: ${(totalWebIfcTime/1000).toFixed(2)}s`);
    console.log(`Overall speedup: ${(totalWebIfcTime/totalIfcLiteTime).toFixed(2)}x`);
  }

  // Qualitative summary
  console.log('');
  console.log('─'.repeat(80));
  console.log('QUALITATIVE ANALYSIS (Geometry Output Comparison)');
  console.log('─'.repeat(80));
  console.log('');

  if (qualitativeResults.length > 0) {
    console.log('File'.padEnd(45) + 'Vert Ratio'.padStart(12) + 'Tri Ratio'.padStart(12) + 'Status'.padStart(15));
    console.log('─'.repeat(84));

    for (const q of qualitativeResults) {
      const name = q.file.length > 42 ? q.file.substring(0, 42) + '...' : q.file;
      const vertRatio = q.hasGeometry ? `${(q.vertexRatio * 100).toFixed(1)}%` : 'N/A';
      const triRatio = q.hasGeometry ? `${(q.triangleRatio * 100).toFixed(1)}%` : 'N/A';

      let status;
      if (!q.hasGeometry) {
        status = '⚠ No geometry';
      } else if (q.triangleRatio >= 0.95 && q.triangleRatio <= 1.05) {
        status = '✓ Match';
      } else if (q.triangleRatio > 1.05) {
        status = '↑ More detail';
      } else {
        status = '↓ Less detail';
      }

      console.log(name.padEnd(45) + vertRatio.padStart(12) + triRatio.padStart(12) + status.padStart(15));
    }

    // Summary stats
    const matchingFiles = qualitativeResults.filter(q => q.hasGeometry && q.triangleRatio >= 0.90);
    const moreDetail = qualitativeResults.filter(q => q.hasGeometry && q.triangleRatio > 1.05);
    const lessDetail = qualitativeResults.filter(q => q.hasGeometry && q.triangleRatio < 0.90);
    const noGeo = qualitativeResults.filter(q => !q.hasGeometry);

    console.log('');
    console.log(`Files with comparable geometry (90-110%): ${matchingFiles.length}`);
    console.log(`Files where IFC-Lite produces more detail: ${moreDetail.length}`);
    console.log(`Files where IFC-Lite produces less detail: ${lessDetail.length}`);
    console.log(`Files with no geometry from either: ${noGeo.length}`);
  }

  // Category breakdown
  console.log('');
  console.log('─'.repeat(80));
  console.log('CATEGORY BREAKDOWN');
  console.log('─'.repeat(80));
  console.log('');

  const categories = [...new Set(successfulResults.map(r => r.category))];
  for (const cat of categories) {
    const catResults = successfulResults.filter(r => r.category === cat);
    const avgCatSpeedup = catResults.reduce((a, r) => a + (r.speedup || 0), 0) / catResults.length;
    console.log(`${cat}: ${catResults.length} files, avg speedup ${avgCatSpeedup.toFixed(2)}x`);
  }

  // Errors summary
  const errorResults = results.filter(r => r.error || r.ifcLite?.error || r.webIfc?.error);
  if (errorResults.length > 0) {
    console.log('');
    console.log('─'.repeat(80));
    console.log('ERRORS');
    console.log('─'.repeat(80));
    console.log('');

    for (const r of errorResults) {
      console.log(`${r.file}:`);
      if (r.error) console.log(`  File error: ${r.error}`);
      if (r.ifcLite?.error) console.log(`  IFC-Lite error: ${r.ifcLite.error}`);
      if (r.webIfc?.error) console.log(`  web-ifc error: ${r.webIfc.error}`);
    }
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('  BENCHMARK COMPLETE');
  console.log('═'.repeat(80));

  // Save detailed results to JSON
  const outputPath = path.join(__dirname, 'benchmark-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    date: new Date().toISOString(),
    config: { warmupRuns: WARMUP_RUNS, benchmarkRuns: BENCHMARK_RUNS },
    results,
    qualitativeResults,
    summary: {
      totalFiles: results.length,
      successfulFiles: successfulResults.length,
      avgSpeedup: speedups.length > 0 ? speedups.reduce((a, b) => a + b, 0) / speedups.length : null,
    }
  }, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

// Run
runBenchmark().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
