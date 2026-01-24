import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { basename } from 'path';
const require = createRequire(import.meta.url);

const FILES = [
  'tests/models/ara3d/ISSUE_159_kleine_Wohnung_R22.ifc',
  'tests/models/ara3d/FM_ARC_DigitalHub.ifc'
];

async function processFile(filePath) {
  const ifcData = readFileSync(filePath);
  const ifcString = ifcData.toString('utf8');

  // IFC-LITE
  const wasmModule = await import('../../packages/wasm/pkg/ifc_lite_wasm.js');
  const wasmBuffer = readFileSync('./packages/wasm/pkg/ifc_lite_wasm_bg.wasm');
  await wasmModule.default(wasmBuffer);
  const ifcLite = new wasmModule.IfcAPI();
  const liteStart = performance.now();
  const meshes = ifcLite.parseMeshes(ifcString);
  const liteTime = performance.now() - liteStart;

  let liteTris = 0;
  for (let i = 0; i < meshes.length; i++) {
    liteTris += meshes.get(i).triangleCount;
  }

  // WEB-IFC
  const WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');
  const webIfc = new WebIFC.IfcAPI();
  await webIfc.Init();
  const webStart = performance.now();
  const modelId = webIfc.OpenModel(ifcData);
  let webTris = 0;
  webIfc.StreamAllMeshes(modelId, (mesh) => {
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i);
      const geom = webIfc.GetGeometry(modelId, placed.geometryExpressID);
      const indices = webIfc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      webTris += indices.length / 3;
      geom.delete();
    }
  });
  const webTime = performance.now() - webStart;
  webIfc.CloseModel(modelId);

  return { liteTris, webTris, liteTime, webTime };
}

async function main() {
  console.log('Testing files with IfcCylindricalSurface geometry:\n');

  for (const file of FILES) {
    console.log('File: ' + basename(file));
    const result = await processFile(file);
    const ratio = (result.liteTris / result.webTris * 100).toFixed(1);
    console.log('   ifc-lite: ' + result.liteTris.toLocaleString() + ' triangles (' + result.liteTime.toFixed(0) + 'ms)');
    console.log('   web-ifc:  ' + result.webTris.toLocaleString() + ' triangles (' + result.webTime.toFixed(0) + 'ms)');
    console.log('   ratio:    ' + ratio + '%');
    console.log();
  }
}

main().catch(console.error);
