/**
 * Spike 2: Triangulation Coverage
 * Goal: 80%+ geometry triangulation success using web-ifc
 * Success: 80%+ coverage on test files
 */

import * as WebIFC from 'web-ifc';

export interface TriangulationSpikeResult {
  passed: boolean;
  coveragePercent: number;
  successCount: number;
  failedCount: number;
  totalCount: number;
  failedTypes: Map<string, number>;
  targetCoverage: number;
}

export async function runTriangulationSpike(file: File): Promise<TriangulationSpikeResult> {
  const targetCoverage = 80; // Target: 80%+
  
  const ifcApi = new WebIFC.IfcAPI();
  
  // Set WASM path to public directory where files are served
  // IMPORTANT: SetWasmPath expects a directory path where the wasm file is located
  // The second parameter (true) indicates this is an absolute path
  // This prevents the library from adding the origin URL again
  ifcApi.SetWasmPath('/', true);
  
  console.log('[Spike 2] Initializing web-ifc (single-threaded)...');
  
  try {
    // Init without custom handler - web-ifc will auto-detect single-threaded mode
    // (SharedArrayBuffer not available without COOP/COEP headers)
    await ifcApi.Init();
    console.log('[Spike 2] web-ifc initialized successfully');
  } catch (error) {
    console.error('[Spike 2] web-ifc Init() failed:', error);
    console.error('[Spike 2] Error details:', error instanceof Error ? error.stack : String(error));
    return {
      passed: false,
      coveragePercent: 0,
      successCount: 0,
      failedCount: 0,
      totalCount: 0,
      failedTypes: new Map(),
      targetCoverage,
    };
  }
  
  console.log('[Spike 2] Opening model...');
  const buffer = await file.arrayBuffer();
  console.log('[Spike 2] Buffer size:', buffer.byteLength, 'bytes');
  
  let modelID: number;
  try {
    modelID = ifcApi.OpenModel(new Uint8Array(buffer));
    console.log('[Spike 2] Model opened, ID:', modelID);
    
    // Check if model opened successfully (returns -1 on failure)
    if (modelID === -1) {
      console.error('[Spike 2] OpenModel returned -1 (failure)');
      return {
        passed: false,
        coveragePercent: 0,
        successCount: 0,
        failedCount: 0,
        totalCount: 0,
        failedTypes: new Map(),
        targetCoverage,
      };
    }
    
    // Verify model schema
    try {
      const schema = ifcApi.GetModelSchema(modelID);
      console.log('[Spike 2] Model schema:', schema);
    } catch (e) {
      console.warn('[Spike 2] Could not get model schema:', e);
    }
  } catch (error) {
    console.error('[Spike 2] OpenModel failed:', error);
    return {
      passed: false,
      coveragePercent: 0,
      successCount: 0,
      failedCount: 0,
      totalCount: 0,
      failedTypes: new Map(),
      targetCoverage,
    };
  }
  
  let successCount = 0;
  let failedCount = 0;
  const failedTypes = new Map<string, number>();
  
  try {
    // Load all geometry
    console.log('[Spike 2] Loading all geometry...');
    let geometries;
    try {
      geometries = ifcApi.LoadAllGeometry(modelID);
      console.log('[Spike 2] LoadAllGeometry returned:', geometries);
    } catch (error) {
      console.error('[Spike 2] LoadAllGeometry failed:', error);
      return {
        passed: false,
        coveragePercent: 0,
        successCount: 0,
        failedCount: 0,
        totalCount: 0,
        failedTypes: new Map(),
        targetCoverage,
      };
    }
    
    // Iterate using size() and get() - web-ifc returns a vector
    const geomCount = geometries.size();
    console.log('[Spike 2] Geometry count:', geomCount);
    
    if (geomCount === 0) {
      console.warn('[Spike 2] No geometry found! Model may not have loaded correctly.');
    }
    
    for (let i = 0; i < geomCount; i++) {
      const flatMesh = geometries.get(i);
      
      // Check if any PlacedGeometry has vertex data
      let hasData = false;
      if (flatMesh.geometries && flatMesh.geometries.size() > 0) {
        for (let j = 0; j < flatMesh.geometries.size(); j++) {
          const placed = flatMesh.geometries.get(j);
          try {
            const meshGeom = ifcApi.GetGeometry(modelID, placed.geometryExpressID);
            const vertexSize = meshGeom.GetVertexDataSize();
            if (vertexSize > 0) {
              hasData = true;
              break;
            }
          } catch (e) {
            // GetGeometry failed for this geometry
          }
        }
      }
      
      if (hasData) {
        successCount++;
      } else {
        failedCount++;
        
        // Try to get entity type for failed geometry
        try {
          const expressID = flatMesh.expressID;
          if (expressID) {
            const type = ifcApi.GetLineType(modelID, expressID);
            const count = failedTypes.get(type) || 0;
            failedTypes.set(type, count + 1);
          }
        } catch (e) {
          // Ignore errors getting type
        }
      }
    }
    
    const totalCount = successCount + failedCount;
    const coveragePercent = totalCount > 0 
      ? (successCount / totalCount) * 100 
      : 0;
    
    const passed = coveragePercent >= targetCoverage;
    
    return {
      passed,
      coveragePercent,
      successCount,
      failedCount,
      totalCount,
      failedTypes,
      targetCoverage,
    };
  } finally {
    ifcApi.CloseModel(modelID);
  }
}
