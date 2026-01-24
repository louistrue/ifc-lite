import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const FILE = process.argv[2] || 'tests/models/ara3d/ISSUE_159_kleine_Wohnung_R22.ifc';

async function processFile(filePath) {
  const ifcData = readFileSync(filePath);
  const ifcString = ifcData.toString('utf8');

  // IFC-LITE
  const wasmModule = await import('../../packages/wasm/pkg/ifc_lite_wasm.js');
  const wasmBuffer = readFileSync('./packages/wasm/pkg/ifc_lite_wasm_bg.wasm');
  await wasmModule.default(wasmBuffer);
  const ifcLite = new wasmModule.IfcAPI();

  console.log('Processing with ifc-lite...');
  const meshes = ifcLite.parseMeshes(ifcString);

  let liteTris = 0;
  let meshCount = 0;
  for (let i = 0; i < meshes.length; i++) {
    const m = meshes.get(i);
    liteTris += m.triangleCount;
    meshCount++;
  }

  console.log('ifc-lite: ' + liteTris.toLocaleString() + ' triangles from ' + meshCount + ' meshes');

  // WEB-IFC
  const WebIFC = require('/tmp/web-ifc-test/node_modules/web-ifc');
  const webIfc = new WebIFC.IfcAPI();
  await webIfc.Init();

  console.log('Processing with web-ifc...');
  const modelId = webIfc.OpenModel(ifcData);
  let webTris = 0;
  let webMeshCount = 0;
  webIfc.StreamAllMeshes(modelId, (mesh) => {
    webMeshCount++;
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placed = mesh.geometries.get(i);
      const geom = webIfc.GetGeometry(modelId, placed.geometryExpressID);
      const indices = webIfc.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      webTris += indices.length / 3;
      geom.delete();
    }
  });
  webIfc.CloseModel(modelId);

  console.log('web-ifc: ' + webTris.toLocaleString() + ' triangles from ' + webMeshCount + ' meshes');
  console.log('ratio: ' + (liteTris / webTris * 100).toFixed(1) + '%');
  console.log('missing: ' + (webTris - liteTris).toLocaleString() + ' triangles');
}

processFile(FILE).catch(console.error);
