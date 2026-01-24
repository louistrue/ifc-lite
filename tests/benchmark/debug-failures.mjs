import { readFileSync } from 'fs';

const FILE = process.argv[2] || 'tests/models/ara3d/ISSUE_159_kleine_Wohnung_R22.ifc';

async function processFile(filePath) {
  const ifcString = readFileSync(filePath, 'utf8');

  // IFC-LITE with debug enabled
  const wasmModule = await import('../../packages/wasm/pkg/ifc_lite_wasm.js');
  const wasmBuffer = readFileSync('./packages/wasm/pkg/ifc_lite_wasm_bg.wasm');
  await wasmModule.default(wasmBuffer);
  const ifcLite = new wasmModule.IfcAPI();

  console.log('Processing...');
  ifcLite.setDebugMode(true);

  // Use diagnostics API if available
  const result = ifcLite.parseMeshesWithDiagnostics
    ? ifcLite.parseMeshesWithDiagnostics(ifcString)
    : { meshes: ifcLite.parseMeshes(ifcString) };

  console.log('\nDiagnostics:');
  if (result.diagnostics) {
    console.log(JSON.stringify(result.diagnostics, null, 2));
  }
}

processFile(FILE).catch(console.error);
