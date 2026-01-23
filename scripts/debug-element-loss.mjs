#!/usr/bin/env node
/**
 * Element Loss Debug Test
 *
 * Standalone test to diagnose why specific IFC elements are lost during parsing.
 * Traces elements through each filtering stage of the pipeline.
 *
 * Usage:
 *   node scripts/debug-element-loss.mjs [path-to-ifc-file]
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initSync, IfcAPI } from '../packages/wasm/pkg/ifc-lite.js';

// Simple entity extractor for debugging (inline to avoid build dependencies)
class EntityExtractor {
  constructor(buffer) {
    this.buffer = buffer;
  }

  extractEntity(ref) {
    try {
      const entityText = new TextDecoder().decode(
        this.buffer.subarray(ref.byteOffset, ref.byteOffset + ref.byteLength)
      );

      // Parse: #ID = TYPE(attr1, attr2, ...)
      const match = entityText.match(/^#(\d+)\s*=\s*(\w+)\((.*)\)/s);
      if (!match) return null;

      const expressId = parseInt(match[1], 10);
      const type = match[2];
      const paramsText = match[3];

      // Parse attributes (simplified - handles basic types)
      const attributes = this.parseAttributes(paramsText);

      return {
        expressId,
        type,
        attributes,
      };
    } catch (error) {
      return null;
    }
  }

  parseAttributes(paramsText) {
    if (!paramsText.trim()) return [];

    const attributes = [];
    let depth = 0;
    let current = '';
    let inString = false;

    for (let i = 0; i < paramsText.length; i++) {
      const char = paramsText[i];

      if (char === "'") {
        if (inString) {
          if (i + 1 < paramsText.length && paramsText[i + 1] === "'") {
            current += "''";
            i++;
            continue;
          }
          inString = false;
        } else {
          inString = true;
        }
        current += char;
      } else if (inString) {
        current += char;
      } else if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        attributes.push(this.parseAttributeValue(current.trim()));
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      attributes.push(this.parseAttributeValue(current.trim()));
    }

    return attributes;
  }

  parseAttributeValue(value) {
    value = value.trim();
    if (!value || value === '$') return null;
    if (value === '.T.' || value === '.F.') return value === '.T.';
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (value.startsWith('#')) {
      return parseInt(value.slice(1), 10);
    }
    if (/^-?\d+$/.test(value)) {
      return parseInt(value, 10);
    }
    if (/^-?\d+\.\d+([eE][+-]?\d+)?$/.test(value)) {
      return parseFloat(value);
    }
    return value;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// Target GlobalIds to investigate
const TARGET_GLOBAL_IDS = [
  '2G8XpoOy8HxxXz4547fLgL', // IFCENERGYCONVERSIONDEVICE
  '0JBHQJ0AKHxxXc4547fLgL', // IFCBEAM
];

// Default IFC file path
const DEFAULT_IFC_FILE = join(ROOT_DIR, '381_32_ARC_MOD_LEI_241025.ifc');

console.log('🔍 Element Loss Debug Test\n');
console.log('Target GlobalIds:', TARGET_GLOBAL_IDS.join(', '));
console.log('');

// Initialize WASM
console.log('📦 Loading WASM...');
const wasmBuffer = readFileSync(join(ROOT_DIR, 'packages/wasm/pkg/ifc-lite_bg.wasm'));
initSync(wasmBuffer);
const api = new IfcAPI();
console.log('✅ WASM initialized\n');

// Read IFC file
const ifcPath = process.argv[2] || DEFAULT_IFC_FILE;
console.log(`📄 Reading IFC file: ${ifcPath}`);
const ifcContent = readFileSync(ifcPath, 'utf-8');
const ifcBuffer = readFileSync(ifcPath);
console.log(`✅ File loaded (${(ifcBuffer.length / 1024 / 1024).toFixed(2)} MB)\n`);

// Step 1: Find entities by GlobalId using regex
console.log('🔎 Step 1: Finding entities by GlobalId...');
const entityMap = new Map(); // GlobalId -> { expressId, type, line }

for (const globalId of TARGET_GLOBAL_IDS) {
  // Find entity definition: #ID = TYPE('GlobalId', ...)
  const regex = new RegExp(`#(\\d+)\\s*=\\s*(\\w+)\\s*\\([^)]*'${globalId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'[^)]*\\)`, 'g');
  const matches = [...ifcContent.matchAll(regex)];
  
  if (matches.length === 0) {
    console.log(`  ❌ GlobalId ${globalId}: NOT FOUND in file`);
    continue;
  }
  
  for (const match of matches) {
    const expressId = parseInt(match[1], 10);
    const type = match[2];
    const lineNumber = ifcContent.substring(0, match.index).split('\n').length;
    
    entityMap.set(globalId, { expressId, type, lineNumber });
    console.log(`  ✅ GlobalId ${globalId}: Found #${expressId} (${type}) at line ${lineNumber}`);
  }
}

if (entityMap.size === 0) {
  console.log('\n❌ No target entities found. Exiting.');
  process.exit(1);
}

console.log('');

// Step 2: Scan all entities to get entity refs
console.log('🔎 Step 2: Scanning all entities...');
const entityRefs = api.scanEntitiesFast(ifcContent);
console.log(`  ✅ Scanned ${entityRefs.length} entities\n`);

// Step 3: Find entity refs for target entities
console.log('🔎 Step 3: Finding entity refs for target entities...');
const targetRefs = new Map(); // GlobalId -> EntityRef

for (const [globalId, info] of entityMap.entries()) {
  const ref = entityRefs.find(r => r.express_id === info.expressId);
  if (!ref) {
    console.log(`  ❌ GlobalId ${globalId}: Entity ref not found (expressId ${info.expressId})`);
    continue;
  }
  
  targetRefs.set(globalId, {
    expressId: ref.express_id,
    type: ref.entity_type,
    byteOffset: ref.byte_offset,
    byteLength: ref.byte_length,
    lineNumber: ref.line_number,
  });
  
  console.log(`  ✅ GlobalId ${globalId}: Found ref (offset: ${ref.byte_offset}, length: ${ref.byte_length})`);
}

console.log('');

// Step 4: Trace through filter stages for each target
console.log('🔎 Step 4: Tracing through filter stages...\n');

const extractor = new EntityExtractor(new Uint8Array(ifcBuffer));

for (const [globalId, info] of entityMap.entries()) {
  const ref = targetRefs.get(globalId);
  if (!ref) {
    console.log(`\n⚠️  Skipping ${globalId} - no entity ref found`);
    continue;
  }
  
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Element: ${globalId}`);
  console.log(`ExpressId: #${ref.expressId}`);
  console.log(`Type: ${ref.type}`);
  console.log(`${'='.repeat(80)}\n`);
  
  // Filter Stage 1: has_geometry_by_name check
  console.log('📋 Filter Stage 1: Type geometry check (has_geometry_by_name)');
  const typeUpper = ref.type.toUpperCase();
  const passesTypeFilter = 
    typeUpper.startsWith('IFC') &&
    !typeUpper.endsWith('TYPE') &&
    !typeUpper.startsWith('IFCREL') &&
    !typeUpper.startsWith('IFCPROPERTY');
  
  console.log(`  Type: ${ref.type}`);
  console.log(`  Passes filter: ${passesTypeFilter ? '✅ YES' : '❌ NO'}`);
  
  if (!passesTypeFilter) {
    console.log(`  ⚠️  ELEMENT LOST AT STAGE 1: Type filter rejected`);
    console.log(`  Reason: Type does not match geometry criteria`);
    continue;
  }
  
  // Filter Stage 2: Extract entity and check representation
  console.log('\n📋 Filter Stage 2: Entity extraction and representation check');
  
  const entityRef = {
    expressId: ref.expressId,
    type: ref.type,
    byteOffset: ref.byteOffset,
    byteLength: ref.byteLength,
    lineNumber: ref.lineNumber,
  };
  
  const entity = extractor.extractEntity(entityRef);
  
  if (!entity) {
    console.log(`  ❌ Failed to extract entity`);
    console.log(`  ⚠️  ELEMENT LOST AT STAGE 2: Entity extraction failed`);
    continue;
  }
  
  console.log(`  ✅ Entity extracted successfully`);
  console.log(`  Attributes count: ${entity.attributes?.length || 0}`);
  
  // Check representation attribute (index 6 for IfcProduct)
  // IFCENERGYCONVERSIONDEVICE: #153335= IFCENERGYCONVERSIONDEVICE('...',#11,'...',$,$,#153340,#153336,$);
  // Attributes: [0]=GlobalId, [1]=OwnerHistory, [2]=Name, [3]=Description, [4]=ObjectType, [5]=ObjectPlacement, [6]=Representation, [7]=Tag
  const representationAttr = entity.attributes?.[6];
  const hasRepresentation = representationAttr !== null && representationAttr !== undefined && representationAttr !== '$';
  
  console.log(`  Representation attribute (index 6): ${JSON.stringify(representationAttr)}`);
  console.log(`  Has representation: ${hasRepresentation ? '✅ YES' : '❌ NO'}`);
  
  if (!hasRepresentation) {
    console.log(`  ⚠️  ELEMENT LOST AT STAGE 2: No representation attribute`);
    continue;
  }
  
    // Filter Stage 3: Geometry processing
    console.log('\n📋 Filter Stage 3: Geometry processing');
    console.log(`  Attempting to process geometry...`);
    
    // Check representation details
    if (typeof representationAttr === 'number') {
      console.log(`  Representation reference: #${representationAttr}`);
      
      // Try to find the representation entity
      const repRef = entityRefs.find(r => r.express_id === representationAttr);
      if (repRef) {
        const repEntityRef = {
          expressId: repRef.express_id,
          type: repRef.entity_type,
          byteOffset: repRef.byte_offset,
          byteLength: repRef.byte_length,
          lineNumber: repRef.line_number,
        };
        const repEntity = extractor.extractEntity(repEntityRef);
        if (repEntity) {
          console.log(`  Representation type: ${repEntity.type}`);
          console.log(`  Representation attributes: ${JSON.stringify(repEntity.attributes?.slice(0, 5))}`);
          
          // Check if representation has items
          if (repEntity.attributes && repEntity.attributes.length > 2) {
            let repItems = repEntity.attributes[2];
            
            // Parse string representation like "(#153333)" or "(#153270,#153281,...)"
            if (typeof repItems === 'string' && repItems.startsWith('(') && repItems.endsWith(')')) {
              const itemsStr = repItems.slice(1, -1); // Remove parentheses
              const itemMatches = itemsStr.matchAll(/#(\d+)/g);
              repItems = Array.from(itemMatches, m => parseInt(m[1], 10));
              console.log(`  Parsed representation items from string: ${repItems.length} items`);
            }
            
            if (Array.isArray(repItems)) {
              console.log(`  Representation items: ${repItems.length} items`);
              console.log(`  Item references: ${repItems.map(r => `#${r}`).join(', ')}`);
              
              // Check first few representation items
              for (let i = 0; i < Math.min(repItems.length, 6); i++) {
                const itemId = repItems[i];
                if (typeof itemId === 'number') {
                  const itemRef = entityRefs.find(r => r.express_id === itemId);
                  if (itemRef) {
                    const itemEntityRef = {
                      expressId: itemRef.express_id,
                      type: itemRef.entity_type,
                      byteOffset: itemRef.byte_offset,
                      byteLength: itemRef.byte_length,
                      lineNumber: itemRef.line_number,
                    };
                    const itemEntity = extractor.extractEntity(itemEntityRef);
                    if (itemEntity) {
                      console.log(`    Item #${itemId}: ${itemEntity.type}`);
                      
                      // If it's an IFCSHAPEREPRESENTATION, check its items
                      if (itemEntity.type === 'IFCSHAPEREPRESENTATION') {
                        console.log(`      This is a shape representation, checking its items...`);
                        if (itemEntity.attributes && itemEntity.attributes.length > 3) {
                          let shapeItems = itemEntity.attributes[3];
                          if (typeof shapeItems === 'string' && shapeItems.startsWith('(') && shapeItems.endsWith(')')) {
                            const itemsStr = shapeItems.slice(1, -1);
                            const itemMatches = itemsStr.matchAll(/#(\d+)/g);
                            shapeItems = Array.from(itemMatches, m => parseInt(m[1], 10));
                            console.log(`      Shape representation items: ${shapeItems.length} items`);
                            console.log(`      Item references: ${shapeItems.map(r => `#${r}`).join(', ')}`);
                            
                            // Check first few items
                            for (let j = 0; j < Math.min(shapeItems.length, 3); j++) {
                              const shapeItemId = shapeItems[j];
                              const shapeItemRef = entityRefs.find(r => r.express_id === shapeItemId);
                              if (shapeItemRef) {
                                const shapeItemEntity = extractor.extractEntity({
                                  expressId: shapeItemRef.express_id,
                                  type: shapeItemRef.entity_type,
                                  byteOffset: shapeItemRef.byte_offset,
                                  byteLength: shapeItemRef.byte_length,
                                  lineNumber: shapeItemRef.line_number,
                                });
                                if (shapeItemEntity) {
                                  console.log(`        Shape item #${shapeItemId}: ${shapeItemEntity.type}`);
                                }
                              }
                            }
                          }
                        }
                      }
                      
                      // Check if it's an IFCEXTRUDEDAREASOLID and has required attributes
                      if (itemEntity.type === 'IFCEXTRUDEDAREASOLID') {
                        console.log(`      Attributes: ${itemEntity.attributes?.length || 0}`);
                        if (itemEntity.attributes && itemEntity.attributes.length >= 4) {
                          const sweptArea = itemEntity.attributes[0];
                          const extrudedDir = itemEntity.attributes[1];
                          const depth = itemEntity.attributes[3];
                          console.log(`      SweptArea: #${sweptArea}`);
                          console.log(`      ExtrudedDirection: #${extrudedDir}`);
                          console.log(`      Depth: ${depth}`);
                          
                          // Check if swept area exists
                          if (typeof sweptArea === 'number') {
                            const areaRef = entityRefs.find(r => r.express_id === sweptArea);
                            if (areaRef) {
                              const areaEntity = extractor.extractEntity({
                                expressId: areaRef.express_id,
                                type: areaRef.entity_type,
                                byteOffset: areaRef.byte_offset,
                                byteLength: areaRef.byte_length,
                                lineNumber: areaRef.line_number,
                              });
                              if (areaEntity) {
                                console.log(`        SweptArea type: ${areaEntity.type}`);
                              } else {
                                console.log(`        ⚠️  SweptArea #${sweptArea} failed to extract`);
                              }
                            } else {
                              console.log(`        ⚠️  SweptArea #${sweptArea} not found`);
                            }
                          }
                        }
                      }
                    } else {
                      console.log(`    ⚠️  Item #${itemId}: Failed to extract entity`);
                    }
                  } else {
                    console.log(`    ⚠️  Item #${itemId}: Entity ref not found`);
                  }
                }
              }
            } else {
              console.log(`  ⚠️  Representation items is not an array: ${typeof repItems} = ${repItems}`);
            }
          }
        }
      }
    }
    
    // Now let's trace through the actual parsing to see what happens
    console.log(`\n  🔍 Tracing parseMeshes processing for expressId #${ref.expressId}...`);
    
    try {
      // We'll scan entities and check if our target is processed
      const geometryEntityRefs = api.scanGeometryEntitiesFast(ifcContent);
      console.log(`  Geometry entities scanned: ${geometryEntityRefs.length}`);
      
      // Check if our target is in the geometry entities list
      const targetInGeometryList = geometryEntityRefs.find(r => r.express_id === ref.expressId);
      if (!targetInGeometryList) {
        console.log(`  ❌ ExpressId #${ref.expressId} NOT in geometry entities list!`);
        console.log(`  ⚠️  ELEMENT LOST AT STAGE 3: Not included in geometry scan`);
        console.log(`  This suggests has_geometry_by_name returned false during scan`);
        continue;
      }
      console.log(`  ✅ ExpressId #${ref.expressId} found in geometry entities list`);
      
      // Parse all meshes and check if our target expressId is in the result
      console.log(`  Processing all meshes (this may take a moment)...`);
      const allMeshes = api.parseMeshes(ifcContent);
      console.log(`  Total meshes parsed: ${allMeshes.length}`);
      
      // Check what expressIds were actually processed
      const processedExpressIds = new Set();
      for (let i = 0; i < allMeshes.length; i++) {
        processedExpressIds.add(allMeshes.get(i).expressId);
        allMeshes.get(i).free();
      }
      allMeshes.free();
      
      console.log(`  Unique expressIds in result: ${processedExpressIds.size}`);
      
      if (!processedExpressIds.has(ref.expressId)) {
        console.log(`  ❌ ExpressId #${ref.expressId} NOT in processed meshes`);
        console.log(`  ⚠️  ELEMENT LOST AT STAGE 3: Geometry processing did not produce mesh`);
        console.log(`  Possible reasons:`);
        console.log(`    - process_element_with_voids returned error`);
        console.log(`    - process_element_with_voids returned empty mesh`);
        console.log(`    - Representation type not supported`);
        console.log(`    - Geometry processing failed silently`);
        console.log(`    - SweptSolid items failed to process`);
        
        // Check if similar elements were processed
        const similarElements = Array.from(processedExpressIds).filter(id => 
          Math.abs(id - ref.expressId) < 100
        ).slice(0, 5);
        if (similarElements.length > 0) {
          console.log(`  Nearby processed expressIds: ${similarElements.join(', ')}`);
        }
        continue;
      }
      
      // Re-parse to get the actual mesh
      console.log(`  ✅ ExpressId #${ref.expressId} found in processed meshes!`);
      const allMeshes2 = api.parseMeshes(ifcContent);
      let foundMesh = null;
      let meshIndex = -1;
      
      for (let i = 0; i < allMeshes2.length; i++) {
        const mesh = allMeshes2.get(i);
        if (mesh.expressId === ref.expressId) {
          foundMesh = mesh;
          meshIndex = i;
          break;
        }
        mesh.free();
      }
      
      if (!foundMesh) {
        console.log(`  ⚠️  Could not retrieve mesh (should not happen)`);
        // Free remaining meshes
        for (let i = 0; i < allMeshes2.length; i++) {
          allMeshes2.get(i).free();
        }
        allMeshes2.free();
        continue;
      }
    
    console.log(`  ✅ Mesh found at index ${meshIndex}`);
    
    // Filter Stage 4: Mesh size check
    console.log('\n📋 Filter Stage 4: Mesh size check');
    const vertexCount = foundMesh.positions.length / 3;
    const triangleCount = foundMesh.indices.length / 3;
    
    console.log(`  Vertices: ${vertexCount}`);
    console.log(`  Triangles: ${triangleCount}`);
    console.log(`  Positions array length: ${foundMesh.positions.length}`);
    console.log(`  Indices array length: ${foundMesh.indices.length}`);
    
    const isEmpty = vertexCount === 0 || triangleCount === 0;
    console.log(`  Is empty: ${isEmpty ? '❌ YES' : '✅ NO'}`);
    
    if (isEmpty) {
      console.log(`  ⚠️  ELEMENT LOST AT STAGE 4: Empty mesh`);
      foundMesh.free();
      allMeshes.free();
      continue;
    }
    
    // Filter Stage 5: Coordinate outlier check
    console.log('\n📋 Filter Stage 5: Coordinate outlier check');
    
    const MAX_REASONABLE_OFFSET = 50_000.0; // 50km from RTC center
    let maxCoord = 0.0;
    let outlierVertexCount = 0;
    
    for (let i = 0; i < foundMesh.positions.length; i += 3) {
      const x = Math.abs(foundMesh.positions[i]);
      const y = Math.abs(foundMesh.positions[i + 1]);
      const z = Math.abs(foundMesh.positions[i + 2]);
      const coordMag = Math.max(x, y, z);
      maxCoord = Math.max(maxCoord, coordMag);
      
      if (coordMag > MAX_REASONABLE_OFFSET) {
        outlierVertexCount++;
      }
    }
    
    const outlierRatio = vertexCount > 0 ? outlierVertexCount / vertexCount : 0;
    const passesOutlierFilter = outlierRatio <= 0.9 && maxCoord <= MAX_REASONABLE_OFFSET * 4.0;
    
    console.log(`  Max coordinate magnitude: ${maxCoord.toFixed(2)}`);
    console.log(`  Outlier vertices (>${MAX_REASONABLE_OFFSET}m): ${outlierVertexCount} / ${vertexCount}`);
    console.log(`  Outlier ratio: ${(outlierRatio * 100).toFixed(1)}%`);
    console.log(`  Passes outlier filter: ${passesOutlierFilter ? '✅ YES' : '❌ NO'}`);
    
    if (!passesOutlierFilter) {
      console.log(`  ⚠️  ELEMENT LOST AT STAGE 5: Coordinate outlier filter`);
      console.log(`  Reason: ${outlierRatio > 0.9 ? `Too many outliers (${(outlierRatio * 100).toFixed(1)}%)` : `Max coord too large (${maxCoord.toFixed(2)}m)`}`);
      foundMesh.free();
      allMeshes.free();
      continue;
    }
    
    // Success!
    console.log('\n✅ ELEMENT SUCCESSFULLY PROCESSED');
    console.log(`  Mesh index: ${meshIndex}`);
    console.log(`  Vertices: ${vertexCount}`);
    console.log(`  Triangles: ${triangleCount}`);
    console.log(`  Max coord: ${maxCoord.toFixed(2)}m`);
    
    foundMesh.free();
    
    // Free remaining meshes
    for (let i = meshIndex + 1; i < allMeshes.length; i++) {
      allMeshes.get(i).free();
    }
    allMeshes.free();
    
  } catch (error) {
    console.log(`  ❌ Error during geometry processing: ${error.message}`);
    console.log(`  ⚠️  ELEMENT LOST AT STAGE 3: Geometry processing error`);
    console.error(error);
  }
}

// Summary report
console.log('\n' + '='.repeat(80));
console.log('📊 SUMMARY REPORT');
console.log('='.repeat(80));

const results = [];

for (const [globalId, info] of entityMap.entries()) {
  const ref = targetRefs.get(globalId);
  if (!ref) {
    results.push({ globalId, status: 'NOT_FOUND', reason: 'Entity ref not found' });
    continue;
  }
  
  // Check if element was found in final mesh collection
  try {
    const allMeshes = api.parseMeshes(ifcContent);
    let found = false;
    
    for (let i = 0; i < allMeshes.length; i++) {
      const mesh = allMeshes.get(i);
      if (mesh.expressId === ref.expressId) {
        found = true;
        const vertexCount = mesh.positions.length / 3;
        const triangleCount = mesh.indices.length / 3;
        results.push({
          globalId,
          status: 'SUCCESS',
          expressId: ref.expressId,
          type: ref.type,
          vertices: vertexCount,
          triangles: triangleCount,
        });
        mesh.free();
        break;
      }
      mesh.free();
    }
    
    // Free remaining meshes
    for (let i = 0; i < allMeshes.length; i++) {
      allMeshes.get(i).free();
    }
    allMeshes.free();
    
    if (!found) {
      results.push({
        globalId,
        status: 'LOST',
        expressId: ref.expressId,
        type: ref.type,
        reason: 'Not in final mesh collection (check stages above)',
      });
    }
  } catch (error) {
    results.push({
      globalId,
      status: 'ERROR',
      reason: error.message,
    });
  }
}

console.log('\nResults:');
for (const result of results) {
  const icon = result.status === 'SUCCESS' ? '✅' : result.status === 'LOST' ? '❌' : '⚠️';
  console.log(`\n${icon} ${result.globalId}`);
  console.log(`   Status: ${result.status}`);
  if (result.expressId) console.log(`   ExpressId: #${result.expressId}`);
  if (result.type) console.log(`   Type: ${result.type}`);
  if (result.vertices !== undefined) {
    console.log(`   Vertices: ${result.vertices}`);
    console.log(`   Triangles: ${result.triangles}`);
  }
  if (result.reason) console.log(`   Reason: ${result.reason}`);
}

console.log('\n' + '='.repeat(80));
console.log('✅ Debug test complete');
console.log('='.repeat(80));
