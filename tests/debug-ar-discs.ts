/**
 * Debug script to investigate "huge disc" artifacts in AR.ifc
 * Tests specific GlobalIds that exhibit the problem
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import WASM
const wasmPath = path.join(__dirname, '../packages/wasm/pkg/ifc-lite.js');

async function main() {

  // Problem GlobalIds from user
  const problemGlobalIds = [
    '0wwJ3om8f1tAO183$SAF1u'
  ];

  // Load AR.ifc
  const ifcPath = '/Users/louistrue/Development/ifc-lite/tests/models/local/AR.ifc';
  console.log(`Loading ${ifcPath}...`);
  const content = fs.readFileSync(ifcPath, 'utf-8');
  console.log(`File size: ${(content.length / 1024 / 1024).toFixed(1)}MB`);

  // Find express IDs for these GlobalIds
  console.log('\n=== Finding problem elements ===');
  const globalIdToExpressId = new Map<string, number>();
  const expressIdToGlobalId = new Map<number, string>();

  // Scan for IfcGloballyUniqueId references
  const entityRegex = /#(\d+)\s*=\s*(\w+)\s*\(([^;]*)\);/g;
  let match;
  while ((match = entityRegex.exec(content)) !== null) {
    const expressId = parseInt(match[1]);
    const typeName = match[2];
    const attrs = match[3];

    // Check if this is a building element with a GlobalId
    if (attrs.startsWith("'")) {
      const globalIdMatch = attrs.match(/^'([^']+)'/);
      if (globalIdMatch) {
        const globalId = globalIdMatch[1];
        if (problemGlobalIds.includes(globalId)) {
          globalIdToExpressId.set(globalId, expressId);
          expressIdToGlobalId.set(expressId, globalId);
          console.log(`Found: ${globalId} -> #${expressId} (${typeName})`);
        }
      }
    }
  }

  // Parse with WASM
  console.log('\n=== Parsing geometry ===');
  const wasmModule = await import(wasmPath);
  const wasmBinaryPath = path.join(__dirname, '../packages/wasm/pkg/ifc-lite_bg.wasm');
  const wasmBinary = fs.readFileSync(wasmBinaryPath);
  wasmModule.initSync({ module: wasmBinary });  // Initialize WASM synchronously
  const api = new wasmModule.IfcAPI();
  const meshes = api.parseMeshes(content);

  console.log(`Total meshes: ${meshes.length}`);
  console.log(`RTC offset: (${meshes.rtcOffsetX}, ${meshes.rtcOffsetY}, ${meshes.rtcOffsetZ})`);

  // Find and analyze problem meshes
  console.log('\n=== Analyzing problem meshes ===');
  const problemExpressIds = new Set([...globalIdToExpressId.values()]);

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes.get(i);
    if (!mesh) continue;

    const expressId = mesh.expressId;
    if (problemExpressIds.has(expressId)) {
      const globalId = expressIdToGlobalId.get(expressId);
      const positions = mesh.positions;
      const vertexCount = positions.length / 3;

      console.log(`\n--- ${globalId} (ExpressID: #${expressId}) ---`);
      console.log(`  IFC Type: ${mesh.ifcType}`);
      console.log(`  Vertices: ${vertexCount}`);
      console.log(`  Triangles: ${mesh.triangleCount}`);

      // Analyze vertex positions
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let outlierCount = 0;
      const OUTLIER_THRESHOLD = 10000; // 10km

      for (let v = 0; v < vertexCount; v++) {
        const x = positions[v * 3];
        const y = positions[v * 3 + 1];
        const z = positions[v * 3 + 2];

        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);

        if (Math.abs(x) > OUTLIER_THRESHOLD ||
            Math.abs(y) > OUTLIER_THRESHOLD ||
            Math.abs(z) > OUTLIER_THRESHOLD) {
          outlierCount++;
          if (outlierCount <= 5) {
            console.log(`  OUTLIER vertex ${v}: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
          }
        }
      }

      console.log(`  Bounds X: [${minX.toFixed(2)}, ${maxX.toFixed(2)}] (span: ${(maxX - minX).toFixed(2)})`);
      console.log(`  Bounds Y: [${minY.toFixed(2)}, ${maxY.toFixed(2)}] (span: ${(maxY - minY).toFixed(2)})`);
      console.log(`  Bounds Z: [${minZ.toFixed(2)}, ${maxZ.toFixed(2)}] (span: ${(maxZ - minZ).toFixed(2)})`);
      console.log(`  Outliers: ${outlierCount}/${vertexCount} (${(outlierCount/vertexCount*100).toFixed(1)}%)`);

      // Check for NaN/Infinity
      let nanCount = 0;
      for (let v = 0; v < positions.length; v++) {
        if (!isFinite(positions[v])) nanCount++;
      }
      if (nanCount > 0) {
        console.log(`  WARNING: ${nanCount} NaN/Infinity values!`);
      }

      // Sample first 10 vertices
      console.log(`  First 10 vertices:`);
      for (let v = 0; v < Math.min(10, vertexCount); v++) {
        const x = positions[v * 3];
        const y = positions[v * 3 + 1];
        const z = positions[v * 3 + 2];
        console.log(`    [${v}]: (${x.toFixed(4)}, ${y.toFixed(4)}, ${z.toFixed(4)})`);
      }

      // Find vertices at extreme positions
      if (maxX - minX > 100 || maxY - minY > 100) {
        console.log(`  EXTREME SPAN DETECTED - finding outlier vertices:`);
        for (let v = 0; v < vertexCount; v++) {
          const x = positions[v * 3];
          const y = positions[v * 3 + 1];
          const z = positions[v * 3 + 2];
          // Find vertices at the extremes
          if (x > 500 || x < -100 || y > 500 || y < -200) {
            console.log(`    Extreme vertex [${v}]: (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
          }
        }
      }
    }
  }

  // Also check: did we find meshes for all problem IDs?
  console.log('\n=== Summary ===');
  for (const globalId of problemGlobalIds) {
    const expressId = globalIdToExpressId.get(globalId);
    if (!expressId) {
      console.log(`${globalId}: NOT FOUND in IFC file`);
    } else {
      let found = false;
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes.get(i);
        if (mesh && mesh.expressId === expressId) {
          found = true;
          break;
        }
      }
      console.log(`${globalId} (#${expressId}): ${found ? 'MESH FOUND' : 'NO MESH GENERATED'}`);
    }
  }
}

main().catch(console.error);
