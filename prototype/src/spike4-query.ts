/**
 * Spike 4: Columnar Query Speed
 * Goal: Filter 500K properties in under 20ms
 * Success: <20ms query time
 */

export interface QuerySpikeResult {
  passed: boolean;
  queryTimeMs: number;
  entityCount: number;
  propertyCount: number;
  resultCount: number;
  targetMs: number;
}

export function runQuerySpike(): QuerySpikeResult {
  const targetMs = 20; // Target: <20ms
  const entityCount = 100_000;
  const propertyCount = 500_000;
  
  // Generate synthetic columnar data
  const entityIds = new Uint32Array(propertyCount);
  const psetNameIndices = new Uint16Array(propertyCount);
  const propNameIndices = new Uint16Array(propertyCount);
  const values = new Float32Array(propertyCount);
  
  // String table simulation
  const stringTable: string[] = [];
  const getStringIndex = (str: string): number => {
    const idx = stringTable.indexOf(str);
    if (idx >= 0) return idx;
    stringTable.push(str);
    return stringTable.length - 1;
  };
  
  // Fill with test data
  const targetPset = getStringIndex('Pset_WallCommon');
  const targetProp = getStringIndex('FireRating');
  
  for (let i = 0; i < propertyCount; i++) {
    entityIds[i] = Math.floor(Math.random() * entityCount);
    
    // Mix of different property sets
    if (i % 5 === 0) {
      psetNameIndices[i] = targetPset;
      propNameIndices[i] = targetProp;
      values[i] = Math.random() * 100; // FireRating 0-100
    } else {
      psetNameIndices[i] = getStringIndex(`Pset_${Math.floor(Math.random() * 10)}`);
      propNameIndices[i] = getStringIndex(`Prop_${Math.floor(Math.random() * 20)}`);
      values[i] = Math.random() * 1000;
    }
  }
  
  // Query: Find all walls with FireRating >= 60
  const startTime = performance.now();
  const results: number[] = [];
  
  for (let i = 0; i < propertyCount; i++) {
    if (psetNameIndices[i] === targetPset && 
        propNameIndices[i] === targetProp && 
        values[i] >= 60) {
      results.push(entityIds[i]);
    }
  }
  
  const endTime = performance.now();
  const queryTimeMs = endTime - startTime;
  
  const passed = queryTimeMs < targetMs;
  
  return {
    passed,
    queryTimeMs,
    entityCount,
    propertyCount,
    resultCount: results.length,
    targetMs,
  };
}
