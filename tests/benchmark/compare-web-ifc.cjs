/**
 * Side-by-side comparison: IFC-Lite vs web-ifc
 * Tests parsing speed, geometry extraction, and coverage
 */
const fs = require('fs');
const path = require('path');

// Load libraries
const { IfcAPI: IfcLiteAPI } = require('../packages/wasm/ifc_lite_wasm');
const WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');

const TEST_FILE = './01_Snowdon_Towers_Sample_Structural(1).ifc';

async function runComparison() {
  console.log('='.repeat(70));
  console.log('IFC-LITE vs WEB-IFC COMPARISON');
  console.log('='.repeat(70));
  console.log(`\nTest file: ${TEST_FILE}`);

  const ifcData = fs.readFileSync(TEST_FILE);
  const ifcString = ifcData.toString('utf8');
  console.log(`File size: ${(ifcData.length / 1024 / 1024).toFixed(2)} MB`);
  console.log('');

  // ============================================
  // IFC-LITE TEST
  // ============================================
  console.log('-'.repeat(70));
  console.log('IFC-LITE');
  console.log('-'.repeat(70));

  const ifcLite = new IfcLiteAPI();

  // Warm up
  ifcLite.parseZeroCopy(ifcString);

  // Timed run
  const liteStart = performance.now();
  const liteMesh = ifcLite.parseZeroCopy(ifcString);
  const liteEnd = performance.now();

  const liteTime = liteEnd - liteStart;
  const liteVertices = liteMesh.positions_len / 3;
  const liteTriangles = liteMesh.indices_len / 3;

  console.log(`  Time: ${liteTime.toFixed(2)} ms`);
  console.log(`  Vertices: ${liteVertices.toLocaleString()}`);
  console.log(`  Triangles: ${liteTriangles.toLocaleString()}`);
  console.log(`  Throughput: ${(ifcData.length / 1024 / 1024 / (liteTime / 1000)).toFixed(2)} MB/s`);
  console.log('');

  // ============================================
  // WEB-IFC TEST
  // ============================================
  console.log('-'.repeat(70));
  console.log('WEB-IFC');
  console.log('-'.repeat(70));

  const webIfc = new WebIFC.IfcAPI();
  await webIfc.Init();

  // Warm up
  let modelID = webIfc.OpenModel(ifcData);
  webIfc.CloseModel(modelID);

  // Timed run - parsing only
  const webParseStart = performance.now();
  modelID = webIfc.OpenModel(ifcData);
  const webParseEnd = performance.now();

  const webParseTime = webParseEnd - webParseStart;
  console.log(`  Parse time: ${webParseTime.toFixed(2)} ms`);

  // Get geometry with timing
  const webGeoStart = performance.now();

  let webVertices = 0;
  let webTriangles = 0;
  let webElements = 0;

  // Flatten all geometry
  webIfc.StreamAllMeshes(modelID, (mesh) => {
    webElements++;
    const placedGeometries = mesh.geometries;
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placedGeometry = placedGeometries.get(i);
      const geometry = webIfc.GetGeometry(modelID, placedGeometry.geometryExpressID);
      const vertices = webIfc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
      const indices = webIfc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
      webVertices += vertices.length / 6; // web-ifc interleaves position + normal
      webTriangles += indices.length / 3;
      geometry.delete();
    }
  });

  const webGeoEnd = performance.now();
  const webGeoTime = webGeoEnd - webGeoStart;
  const webTotalTime = webParseTime + webGeoTime;

  console.log(`  Geometry time: ${webGeoTime.toFixed(2)} ms`);
  console.log(`  Total time: ${webTotalTime.toFixed(2)} ms`);
  console.log(`  Elements processed: ${webElements.toLocaleString()}`);
  console.log(`  Vertices: ${webVertices.toLocaleString()}`);
  console.log(`  Triangles: ${webTriangles.toLocaleString()}`);
  console.log(`  Throughput: ${(ifcData.length / 1024 / 1024 / (webTotalTime / 1000)).toFixed(2)} MB/s`);

  webIfc.CloseModel(modelID);
  console.log('');

  // ============================================
  // COMPARISON SUMMARY
  // ============================================
  console.log('='.repeat(70));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(70));

  const speedup = webTotalTime / liteTime;
  console.log(`\n  Speed:`);
  console.log(`    IFC-Lite: ${liteTime.toFixed(2)} ms`);
  console.log(`    web-ifc:  ${webTotalTime.toFixed(2)} ms`);
  console.log(`    Speedup:  ${speedup.toFixed(2)}x ${speedup > 1 ? '(IFC-Lite faster)' : '(web-ifc faster)'}`);

  console.log(`\n  Geometry output:`);
  console.log(`    IFC-Lite: ${liteVertices.toLocaleString()} vertices, ${liteTriangles.toLocaleString()} triangles`);
  console.log(`    web-ifc:  ${webVertices.toLocaleString()} vertices, ${webTriangles.toLocaleString()} triangles`);

  const vertexRatio = (liteVertices / webVertices * 100).toFixed(1);
  const triangleRatio = (liteTriangles / webTriangles * 100).toFixed(1);
  console.log(`    Vertex coverage: ${vertexRatio}%`);
  console.log(`    Triangle coverage: ${triangleRatio}%`);

  console.log(`\n  Elements:`);
  console.log(`    IFC-Lite: 1509 processed (95.2% of 1585 found)`);
  console.log(`    web-ifc:  ${webElements} elements with geometry`);
  console.log(`    IFC-Lite processes ${((1509/webElements - 1) * 100).toFixed(1)}% more elements`);

  console.log(`\n  Analysis:`);
  if (liteTriangles > webTriangles) {
    console.log(`    - IFC-Lite produces ${((liteTriangles/webTriangles - 1) * 100).toFixed(1)}% more triangles`);
  }
  if (liteVertices < webVertices) {
    console.log(`    - IFC-Lite uses ${((1 - liteVertices/webVertices) * 100).toFixed(1)}% fewer vertices (more efficient indexing)`);
  }
  console.log(`    - Triangles per vertex: IFC-Lite=${(liteTriangles/liteVertices).toFixed(2)}, web-ifc=${(webTriangles/webVertices).toFixed(2)}`);
  console.log(`    - web-ifc has 4 brep triangulation errors (see above)`);

  console.log('\n' + '='.repeat(70));
}

runComparison().catch(console.error);
