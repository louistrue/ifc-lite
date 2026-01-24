/**
 * Void Geometry Debug Script
 * Compares geometry counts between web-ifc and ifc-lite for debugging opening voids
 */
const fs = require('fs');
const path = require('path');

// Test file - change this to test different models
const TEST_FILE = process.argv[2] || 'tests/models/various/rvt01.ifc';

async function main() {
  console.log('='.repeat(70));
  console.log('VOID GEOMETRY DEBUG: web-ifc vs ifc-lite');
  console.log('='.repeat(70));
  console.log(`\nTest file: ${TEST_FILE}`);

  // Check if file exists
  if (!fs.existsSync(TEST_FILE)) {
    console.error(`ERROR: File not found: ${TEST_FILE}`);
    process.exit(1);
  }

  const ifcData = fs.readFileSync(TEST_FILE);
  const ifcString = ifcData.toString('utf8');
  console.log(`File size: ${(ifcData.length / 1024 / 1024).toFixed(2)} MB`);

  // Count IfcOpeningElement entities in the file
  const openingMatches = ifcString.match(/IFCOPENINGELEMENT\s*\(/gi) || [];
  const wallMatches = ifcString.match(/IFCWALL(STANDARDCASE)?\s*\(/gi) || [];
  const voidRelMatches = ifcString.match(/IFCRELVOIDSELEMENT\s*\(/gi) || [];

  console.log(`\nIFC Statistics:`);
  console.log(`  IfcOpeningElement: ${openingMatches.length}`);
  console.log(`  IfcWall/IfcWallStandardCase: ${wallMatches.length}`);
  console.log(`  IfcRelVoidsElement: ${voidRelMatches.length}`);
  console.log('');

  // ============================================
  // IFC-LITE TEST
  // ============================================
  console.log('-'.repeat(70));
  console.log('IFC-LITE');
  console.log('-'.repeat(70));

  let ifcLiteResults = null;
  try {
    // Dynamic import for ES module
    const initIfcLite = await import('../../packages/wasm/pkg/ifc-lite.js');
    await initIfcLite.default();
    const { IfcAPI } = initIfcLite;

    const ifcLite = new IfcAPI();

    const liteStart = performance.now();
    const meshes = ifcLite.parseMeshes(ifcString);
    const liteEnd = performance.now();

    let totalVerts = 0;
    let totalTris = 0;
    const meshCountsByType = {};

    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes.get(i);
      totalVerts += mesh.vertexCount;
      totalTris += mesh.triangleCount;

      const ifcType = mesh.ifcType || 'Unknown';
      if (!meshCountsByType[ifcType]) {
        meshCountsByType[ifcType] = { count: 0, verts: 0, tris: 0 };
      }
      meshCountsByType[ifcType].count++;
      meshCountsByType[ifcType].verts += mesh.vertexCount;
      meshCountsByType[ifcType].tris += mesh.triangleCount;
    }

    console.log(`  Time: ${(liteEnd - liteStart).toFixed(2)} ms`);
    console.log(`  Total Meshes: ${meshes.length}`);
    console.log(`  Total Vertices: ${totalVerts.toLocaleString()}`);
    console.log(`  Total Triangles: ${totalTris.toLocaleString()}`);
    console.log(`\n  Meshes by IFC Type:`);

    const sortedTypes = Object.entries(meshCountsByType)
      .sort((a, b) => b[1].tris - a[1].tris)
      .slice(0, 15);

    for (const [type, data] of sortedTypes) {
      console.log(`    ${type}: ${data.count} meshes, ${data.verts.toLocaleString()} verts, ${data.tris.toLocaleString()} tris`);
    }

    ifcLiteResults = {
      meshCount: meshes.length,
      vertices: totalVerts,
      triangles: totalTris,
      byType: meshCountsByType
    };

  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    console.error(err.stack);
  }
  console.log('');

  // ============================================
  // WEB-IFC TEST
  // ============================================
  console.log('-'.repeat(70));
  console.log('WEB-IFC');
  console.log('-'.repeat(70));

  let webIfcResults = null;
  try {
    const WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');
    const webIfc = new WebIFC.IfcAPI();
    await webIfc.Init();

    const webStart = performance.now();
    const modelId = webIfc.OpenModel(ifcData);

    let webVertices = 0;
    let webTriangles = 0;
    let webMeshes = 0;

    webIfc.StreamAllMeshes(modelId, (mesh) => {
      const placedGeometries = mesh.geometries;
      for (let i = 0; i < placedGeometries.size(); i++) {
        const placedGeometry = placedGeometries.get(i);
        const geometry = webIfc.GetGeometry(modelId, placedGeometry.geometryExpressID);
        const vertices = webIfc.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
        const indices = webIfc.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
        webVertices += vertices.length / 6; // web-ifc interleaves position + normal
        webTriangles += indices.length / 3;
        webMeshes++;
        geometry.delete();
      }
    });

    const webEnd = performance.now();

    console.log(`  Time: ${(webEnd - webStart).toFixed(2)} ms`);
    console.log(`  Total Meshes: ${webMeshes}`);
    console.log(`  Total Vertices: ${webVertices.toLocaleString()}`);
    console.log(`  Total Triangles: ${webTriangles.toLocaleString()}`);

    webIfcResults = {
      meshCount: webMeshes,
      vertices: webVertices,
      triangles: webTriangles
    };

    webIfc.CloseModel(modelId);

  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    console.error(`  Make sure web-ifc is installed: npm install web-ifc --prefix /tmp/web-ifc-test`);
  }
  console.log('');

  // ============================================
  // COMPARISON
  // ============================================
  if (ifcLiteResults && webIfcResults) {
    console.log('='.repeat(70));
    console.log('COMPARISON');
    console.log('='.repeat(70));

    const meshDiff = ifcLiteResults.meshCount - webIfcResults.meshCount;
    const vertDiff = ifcLiteResults.vertices - webIfcResults.vertices;
    const triDiff = ifcLiteResults.triangles - webIfcResults.triangles;

    console.log(`\n  Meshes:    ifc-lite=${ifcLiteResults.meshCount}, web-ifc=${webIfcResults.meshCount}, diff=${meshDiff > 0 ? '+' : ''}${meshDiff}`);
    console.log(`  Vertices:  ifc-lite=${ifcLiteResults.vertices.toLocaleString()}, web-ifc=${webIfcResults.vertices.toLocaleString()}, diff=${vertDiff > 0 ? '+' : ''}${vertDiff.toLocaleString()}`);
    console.log(`  Triangles: ifc-lite=${ifcLiteResults.triangles.toLocaleString()}, web-ifc=${webIfcResults.triangles.toLocaleString()}, diff=${triDiff > 0 ? '+' : ''}${triDiff.toLocaleString()}`);

    const vertRatio = (ifcLiteResults.vertices / webIfcResults.vertices * 100).toFixed(1);
    const triRatio = (ifcLiteResults.triangles / webIfcResults.triangles * 100).toFixed(1);

    console.log(`\n  Vertex ratio: ${vertRatio}%`);
    console.log(`  Triangle ratio: ${triRatio}%`);

    if (Math.abs(triDiff) > webIfcResults.triangles * 0.05) {
      console.log(`\n  WARNING: Triangle count differs by more than 5%!`);
      console.log(`  This may indicate geometry processing differences.`);
    }

    if (Math.abs(vertDiff) > webIfcResults.vertices * 0.1 && vertDiff > 0) {
      console.log(`\n  NOTE: ifc-lite has ${((vertDiff / webIfcResults.vertices) * 100).toFixed(1)}% more vertices.`);
      console.log(`  This may indicate different vertex deduplication strategies.`);
    }
  }

  console.log('\n' + '='.repeat(70));
}

main().catch(console.error);
