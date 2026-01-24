#!/usr/bin/env node
/**
 * Detailed comparison of rvt01.ifc between ifc-lite and web-ifc
 * Shows which entity types are missing or have different triangle counts
 */
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const FILE_PATH = 'tests/models/various/rvt01.ifc';

async function main() {
  const ifcData = readFileSync(FILE_PATH);
  const ifcString = ifcData.toString('utf8');
  console.log(`\n📁 Analyzing: ${FILE_PATH}`);
  console.log(`   Size: ${(ifcData.length / 1024 / 1024).toFixed(2)} MB\n`);

  // IFC-LITE
  console.log('🔵 Loading ifc-lite...');
  const wasmModule = await import('../../packages/wasm/pkg/ifc-lite.js');
  const wasmBuffer = readFileSync('./packages/wasm/pkg/ifc-lite_bg.wasm');
  await wasmModule.default(wasmBuffer);

  const ifcLite = new wasmModule.IfcAPI();
  const liteMeshes = ifcLite.parseMeshes(ifcString);

  // Build map of entity ID -> mesh data for ifc-lite
  const liteMap = new Map();
  const liteTypeCount = new Map();
  let liteTotalTris = 0;
  for (let i = 0; i < liteMeshes.length; i++) {
    const mesh = liteMeshes.get(i);
    const expressId = mesh.expressId;
    const ifcType = mesh.ifcType;
    liteMap.set(expressId, {
      triangles: mesh.triangleCount,
      vertices: mesh.vertexCount,
      type: ifcType
    });
    liteTypeCount.set(ifcType, (liteTypeCount.get(ifcType) || 0) + mesh.triangleCount);
    liteTotalTris += mesh.triangleCount;
  }
  console.log(`   ifc-lite: ${liteMeshes.length} meshes, ${liteTotalTris} triangles`);

  // WEB-IFC
  console.log('🟢 Loading web-ifc...');
  const WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');
  const webIfc = new WebIFC.IfcAPI();
  await webIfc.Init();
  const modelId = webIfc.OpenModel(ifcData);

  // Use GetAllTypesOfModel to find entities with geometry
  const webMap = new Map();
  const webTypeCount = new Map();
  let webTotalTris = 0;
  let webMeshCount = 0;

  // Get flat mesh for each streamable mesh
  webIfc.StreamAllMeshes(modelId, (mesh) => {
    const expressId = mesh.expressID;
    let totalTris = 0;
    let totalVerts = 0;

    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i);
      const geom = webIfc.GetGeometry(modelId, placed.geometryExpressID);
      const verts = webIfc.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indices = webIfc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      totalVerts += verts.length / 6;
      totalTris += indices.length / 3;
      geom.delete();
    }

    if (totalTris > 0) {
      // Get type name
      const line = webIfc.GetLine(modelId, expressId);
      const typeName = line ? getTypeName(line.type) : 'Unknown';

      webMap.set(expressId, {
        triangles: totalTris,
        vertices: totalVerts,
        type: typeName
      });
      webTypeCount.set(typeName, (webTypeCount.get(typeName) || 0) + totalTris);
      webTotalTris += totalTris;
      webMeshCount++;
    }
  });

  console.log(`   web-ifc:  ${webMeshCount} meshes, ${webTotalTris} triangles`);

  // Compare
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON RESULTS');
  console.log('='.repeat(80));

  console.log(`\n📊 Overall Stats:`);
  console.log(`   ifc-lite: ${liteMeshes.length} meshes, ${liteTotalTris} triangles`);
  console.log(`   web-ifc:  ${webMeshCount} meshes, ${webTotalTris} triangles`);
  console.log(`   Ratio:    ${((liteTotalTris / webTotalTris) * 100).toFixed(1)}%`);

  // Find missing entities
  const missingInLite = [];
  const missingInWeb = [];
  const different = [];

  for (const [id, webData] of webMap) {
    const liteData = liteMap.get(id);
    if (!liteData) {
      missingInLite.push({ id, ...webData });
    } else if (Math.abs(liteData.triangles - webData.triangles) > 2) {
      different.push({
        id,
        liteTriangles: liteData.triangles,
        webTriangles: webData.triangles,
        type: webData.type || liteData.type
      });
    }
  }

  for (const [id, liteData] of liteMap) {
    if (!webMap.has(id)) {
      missingInWeb.push({ id, ...liteData });
    }
  }

  // Group missing by type
  console.log(`\n❌ Missing in ifc-lite: ${missingInLite.length} entities`);
  if (missingInLite.length > 0) {
    const byType = new Map();
    for (const m of missingInLite) {
      const type = m.type || 'Unknown';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(m);
    }
    for (const [type, entities] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const totalTris = entities.reduce((sum, e) => sum + e.triangles, 0);
      console.log(`   ${type}: ${entities.length} entities (${totalTris} triangles)`);
      // Show first 5 entity IDs for debugging
      const first5 = entities.slice(0, 5);
      for (const e of first5) {
        console.log(`      #${e.id}: ${e.triangles} tris`);
      }
      if (entities.length > 5) {
        console.log(`      ... and ${entities.length - 5} more`);
      }
    }
  }

  console.log(`\n⚠️  Different triangle counts: ${different.length} entities`);
  if (different.length > 0) {
    for (const d of different.slice(0, 20)) {
      const diff = d.liteTriangles - d.webTriangles;
      const pct = ((d.liteTriangles / d.webTriangles) * 100).toFixed(1);
      console.log(`   #${d.id} (${d.type}): lite=${d.liteTriangles}, web=${d.webTriangles} (${pct}%)`);
    }
    if (different.length > 20) {
      console.log(`   ... and ${different.length - 20} more`);
    }
  }

  console.log(`\n✅ Extra in ifc-lite (not in web-ifc): ${missingInWeb.length} entities`);
  if (missingInWeb.length > 0) {
    const byType = new Map();
    for (const m of missingInWeb) {
      const type = m.type || 'Unknown';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(m);
    }
    for (const [type, entities] of [...byType.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const totalTris = entities.reduce((sum, e) => sum + e.triangles, 0);
      console.log(`   ${type}: ${entities.length} entities (${totalTris} triangles)`);
    }
  }

  // Triangle count by type comparison
  console.log('\n📈 Triangle count by type:');
  console.log('   Type                          | ifc-lite    | web-ifc     | Diff');
  console.log('   ' + '-'.repeat(70));

  const allTypes = new Set([...liteTypeCount.keys(), ...webTypeCount.keys()]);
  for (const type of [...allTypes].sort()) {
    const lite = liteTypeCount.get(type) || 0;
    const web = webTypeCount.get(type) || 0;
    const diff = lite - web;
    const diffStr = diff === 0 ? '=' : (diff > 0 ? `+${diff}` : `${diff}`);
    if (lite > 0 || web > 0) {
      console.log(`   ${type.padEnd(30)} | ${String(lite).padStart(11)} | ${String(web).padStart(11)} | ${diffStr}`);
    }
  }

  webIfc.CloseModel(modelId);
  console.log('\n');
}

function getTypeName(typeId) {
  // IFC type IDs from web-ifc
  const types = {
    2391406946: 'IfcWall',
    3512223829: 'IfcWallStandardCase',
    1529196076: 'IfcSlab',
    3027962421: 'IfcSlabStandardCase',
    1973544240: 'IfcCovering',
    2262370178: 'IfcRailing',
    395920057: 'IfcDoor',
    3304561284: 'IfcWindow',
    3856911033: 'IfcSpace',
    3588315303: 'IfcOpeningElement',
    3079942009: 'IfcOpeningStandardCase',
    1073191201: 'IfcMember',
    3171933400: 'IfcPlate',
    753842376: 'IfcBeam',
    843113511: 'IfcColumn',
    3495092785: 'IfcCurtainWall',
    2979338954: 'IfcBuildingElementPart',
    4123344466: 'IfcElementAssembly',
    1620046519: 'IfcTransportElement',
    1677625105: 'IfcCivilElement',
    2082059205: 'IfcBuildingElementProxy',
    900683007: 'IfcFooting',
    3495092785: 'IfcCurtainWall',
  };
  return types[typeId] || `Type_${typeId}`;
}

main().catch(console.error);
