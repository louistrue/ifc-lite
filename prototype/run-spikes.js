#!/usr/bin/env node

/**
 * Run feasibility spikes from command line
 * Note: Spike 3 (WebGPU) requires browser - run that manually
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as WebIFC from 'web-ifc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import spike functions (we'll need to adapt them for Node.js)
async function runSpike1(filePath) {
  console.log('\n🔍 Spike 1: Parsing Speed');
  console.log('─'.repeat(50));
  
  const buffer = readFileSync(filePath);
  const bytes = new Uint8Array(buffer);
  const fileSizeMB = buffer.byteLength / (1024 * 1024);
  
  const startTime = performance.now();
  let entityCount = 0;
  
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 35) { // '#' character
      entityCount++;
    }
  }
  
  const endTime = performance.now();
  const scanTimeMs = endTime - startTime;
  const throughputMBps = fileSizeMB / (scanTimeMs / 1000);
  const targetMBps = 500;
  const passed = throughputMBps >= targetMBps;
  
  console.log(`File Size:     ${fileSizeMB.toFixed(2)} MB`);
  console.log(`Scan Time:     ${scanTimeMs.toFixed(2)} ms`);
  console.log(`Throughput:    ${throughputMBps.toFixed(2)} MB/s`);
  console.log(`Target:        >${targetMBps} MB/s`);
  console.log(`Entity Count:  ${entityCount.toLocaleString()}`);
  console.log(`Status:        ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return { passed, scanTimeMs, fileSizeMB, throughputMBps, entityCount, targetMBps };
}

async function runSpike2(filePath) {
  console.log('\n📐 Spike 2: Triangulation Coverage');
  console.log('─'.repeat(50));
  
  const targetCoverage = 80;
  
  try {
    const ifcApi = new WebIFC.IfcAPI();
    await ifcApi.Init();
    
    const buffer = readFileSync(filePath);
    const modelID = ifcApi.OpenModel(new Uint8Array(buffer));
    
    let successCount = 0;
    let failedCount = 0;
    const failedTypes = new Map();
    
    try {
      const geometries = ifcApi.LoadAllGeometry(modelID);
      
      // Iterate using size() and get() - web-ifc returns a vector
      const geomCount = geometries.size();
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
      
      console.log(`Coverage:      ${coveragePercent.toFixed(1)}%`);
      console.log(`Target:        ≥${targetCoverage}%`);
      console.log(`Success:       ${successCount.toLocaleString()}`);
      console.log(`Failed:        ${failedCount.toLocaleString()}`);
      console.log(`Total:         ${totalCount.toLocaleString()}`);
      
      if (failedTypes.size > 0) {
        console.log('\nFailed Types (top 10):');
        const sorted = Array.from(failedTypes.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        sorted.forEach(([type, count]) => {
          console.log(`  ${type}: ${count}`);
        });
      }
      
      console.log(`Status:        ${passed ? '✅ PASS' : '❌ FAIL'}`);
      
      ifcApi.CloseModel(modelID);
      
      return { passed, coveragePercent, successCount, failedCount, totalCount, failedTypes, targetCoverage };
    } catch (error) {
      ifcApi.CloseModel(modelID);
      throw error;
    }
  } catch (error) {
    console.log(`Error:         ${error.message}`);
    console.log(`Status:        ❌ FAIL`);
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
}

function runSpike4() {
  console.log('\n🔎 Spike 4: Columnar Query Speed');
  console.log('─'.repeat(50));
  
  const targetMs = 20;
  const entityCount = 100_000;
  const propertyCount = 500_000;
  
  // Generate synthetic columnar data
  const entityIds = new Uint32Array(propertyCount);
  const psetNameIndices = new Uint16Array(propertyCount);
  const propNameIndices = new Uint16Array(propertyCount);
  const values = new Float32Array(propertyCount);
  
  // String table simulation
  const stringTable = [];
  const getStringIndex = (str) => {
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
  const results = [];
  
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
  
  console.log(`Query Time:    ${queryTimeMs.toFixed(2)} ms`);
  console.log(`Target:        <${targetMs} ms`);
  console.log(`Entities:      ${entityCount.toLocaleString()}`);
  console.log(`Properties:    ${propertyCount.toLocaleString()}`);
  console.log(`Results:       ${results.length.toLocaleString()}`);
  console.log(`Status:        ${passed ? '✅ PASS' : '❌ FAIL'}`);
  
  return { passed, queryTimeMs, entityCount, propertyCount, resultCount: results.length, targetMs };
}

async function main() {
  const filePath = process.argv[2];
  
  if (!filePath) {
    console.error('Usage: node run-spikes.js <path-to-ifc-file>');
    process.exit(1);
  }
  
  console.log('🚀 IFC-Lite Feasibility Spikes');
  console.log('═'.repeat(50));
  console.log(`File: ${filePath}`);
  
  const results = [];
  
  // Run Spike 1
  results.push(await runSpike1(filePath));
  
  // Run Spike 2
  results.push(await runSpike2(filePath));
  
  // Run Spike 4
  results.push(runSpike4());
  
  // Summary
  console.log('\n' + '═'.repeat(50));
  console.log('📊 Summary');
  console.log('─'.repeat(50));
  
  const spikeNames = ['Spike 1: Parsing', 'Spike 2: Triangulation', 'Spike 4: Query'];
  results.forEach((result, i) => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${spikeNames[i]}: ${status}`);
  });
  
  const allPassed = results.every(r => r.passed);
  console.log('\n' + '═'.repeat(50));
  console.log(`Overall: ${allPassed ? '✅ ALL PASSED' : '⚠️  SOME FAILED'}`);
  console.log('\nNote: Spike 3 (WebGPU) requires browser - test at http://localhost:3000');
  console.log('═'.repeat(50));
}

main().catch(console.error);
