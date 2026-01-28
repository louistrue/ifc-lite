/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Debug script for AR.ifc geometry issues - WASM Processing
 *
 * This script processes the IFC file through the actual WASM geometry pipeline
 * and analyzes the output meshes to verify fixes.
 *
 * Run: npx tsx tests/debug-ar-geometry-wasm.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Target entities from the screenshots
const TARGET_GUIDS = {
  covering: '0cQX$rcqbFoQKGBpkuqVOC', // IfcCovering with spikes - #739996
  wall: '12_xLsc_f3OgK3Ufdk0jPo',    // IfcWall with openings not cut - #443610
  window: '12_xLsc_f3OgK3Ufdk0ghH',   // IfcWindow multi-part selection - #469622
};

// Express IDs from IFC file analysis
const TARGET_EXPRESS_IDS = {
  covering: 739996,
  wall: 443610,
  window: 469622,
};

interface MeshAnalysis {
  expressId: number;
  ifcType: string;
  vertexCount: number;
  triangleCount: number;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  hasSpikes: boolean;
  spikeDetails?: string;
}

async function main() {
  console.log('\n' + '='.repeat(80));
  console.log('AR.ifc WASM Geometry Debug Analysis');
  console.log('='.repeat(80) + '\n');

  const ifcPath = path.join(__dirname, 'models', 'local', 'AR.ifc');

  if (!fs.existsSync(ifcPath)) {
    console.error(`File not found: ${ifcPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(ifcPath, 'utf-8');
  console.log(`File loaded: ${(content.length / 1024 / 1024).toFixed(2)} MB\n`);

  // Import WASM module
  console.log('Loading WASM module...');
  const wasm = await import('../packages/wasm/pkg/ifc-lite.js');
  await wasm.default();
  console.log('WASM module loaded.\n');

  // Create API instance
  const api = new wasm.IfcAPI();

  console.log('Parsing meshes (this may take a while for large files)...');
  const startTime = Date.now();

  let meshCollection;
  try {
    meshCollection = api.parseMeshes(content);
  } catch (error) {
    console.error('WASM mesh parsing failed:', error);
    process.exit(1);
  }

  const parseTime = Date.now() - startTime;
  console.log(`Parsing complete in ${(parseTime / 1000).toFixed(2)}s`);
  console.log(`Total meshes: ${meshCollection.length}\n`);

  // Find target meshes and analyze them
  const targetMeshes: Map<string, MeshAnalysis[]> = new Map();

  for (const [key, expressId] of Object.entries(TARGET_EXPRESS_IDS)) {
    targetMeshes.set(key, []);
  }

  // Collect all meshes for target entities
  for (let i = 0; i < meshCollection.length; i++) {
    const mesh = meshCollection.get(i);
    if (!mesh) continue;

    const expressId = mesh.expressId;

    // Check if this is one of our target entities
    for (const [key, targetId] of Object.entries(TARGET_EXPRESS_IDS)) {
      if (expressId === targetId) {
        const positions = mesh.positions;
        const indices = mesh.indices;
        const vertexCount = positions.length / 3;
        const triangleCount = indices.length / 3;

        // Calculate bounds
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let v = 0; v < positions.length; v += 3) {
          const x = positions[v];
          const y = positions[v + 1];
          const z = positions[v + 2];
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          maxZ = Math.max(maxZ, z);
        }

        // Check for spikes (triangles with abnormally large edge lengths)
        const { hasSpikes, spikeDetails } = analyzeForSpikes(positions, indices);

        targetMeshes.get(key)!.push({
          expressId,
          ifcType: mesh.ifcType,
          vertexCount,
          triangleCount,
          bounds: {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
          },
          hasSpikes,
          spikeDetails,
        });
      }
    }

    mesh.free();
  }

  meshCollection.free();

  // Print analysis results
  console.log('='.repeat(80));
  console.log('ANALYSIS RESULTS');
  console.log('='.repeat(80) + '\n');

  // ISSUE 1: Covering spikes
  console.log('ISSUE 1: COVERING GEOMETRY SPIKES');
  console.log('-'.repeat(60));
  const coveringMeshes = targetMeshes.get('covering') || [];
  if (coveringMeshes.length === 0) {
    console.log('WARNING: No mesh found for covering entity!');
  } else {
    for (const mesh of coveringMeshes) {
      console.log(`  Express ID: ${mesh.expressId}`);
      console.log(`  Type: ${mesh.ifcType}`);
      console.log(`  Vertices: ${mesh.vertexCount}`);
      console.log(`  Triangles: ${mesh.triangleCount}`);
      console.log(`  Bounds: (${mesh.bounds.min.map(v => v.toFixed(3)).join(', ')}) to (${mesh.bounds.max.map(v => v.toFixed(3)).join(', ')})`);
      console.log(`  HAS SPIKES: ${mesh.hasSpikes ? 'YES - ISSUE NOT FIXED!' : 'NO - FIXED!'}`);
      if (mesh.spikeDetails) {
        console.log(`  Spike details: ${mesh.spikeDetails}`);
      }
    }
  }
  console.log();

  // ISSUE 2: Wall openings
  console.log('ISSUE 2: WALL OPENINGS NOT CUT');
  console.log('-'.repeat(60));
  const wallMeshes = targetMeshes.get('wall') || [];
  if (wallMeshes.length === 0) {
    console.log('WARNING: No mesh found for wall entity!');
  } else {
    for (const mesh of wallMeshes) {
      console.log(`  Express ID: ${mesh.expressId}`);
      console.log(`  Type: ${mesh.ifcType}`);
      console.log(`  Vertices: ${mesh.vertexCount}`);
      console.log(`  Triangles: ${mesh.triangleCount}`);
      console.log(`  Bounds: (${mesh.bounds.min.map(v => v.toFixed(3)).join(', ')}) to (${mesh.bounds.max.map(v => v.toFixed(3)).join(', ')})`);

      // A wall with 8 openings should have significantly more triangles than a solid wall
      // A solid wall typically has 12 triangles (6 faces * 2 triangles)
      // With openings, it should have many more triangles due to the cut edges
      const expectedMinTriangles = 50; // With 8 openings, expect at least this many triangles
      const hasOpeningCuts = mesh.triangleCount > expectedMinTriangles;
      console.log(`  Triangle count analysis: ${mesh.triangleCount} triangles`);
      console.log(`  OPENINGS CUT: ${hasOpeningCuts ? 'LIKELY YES - Has many triangles' : 'LIKELY NO - Too few triangles for 8 openings'}`);
    }
  }
  console.log();

  // ISSUE 3: Window selection
  console.log('ISSUE 3: WINDOW MULTI-PART SELECTION');
  console.log('-'.repeat(60));
  const windowMeshes = targetMeshes.get('window') || [];
  if (windowMeshes.length === 0) {
    console.log('WARNING: No mesh found for window entity!');
  } else {
    console.log(`  Total mesh pieces for window: ${windowMeshes.length}`);
    let totalVertices = 0;
    let totalTriangles = 0;
    for (let i = 0; i < windowMeshes.length; i++) {
      const mesh = windowMeshes[i];
      console.log(`  Piece ${i + 1}: ${mesh.vertexCount} vertices, ${mesh.triangleCount} triangles`);
      totalVertices += mesh.vertexCount;
      totalTriangles += mesh.triangleCount;
    }
    console.log(`  Total: ${totalVertices} vertices, ${totalTriangles} triangles`);
    console.log(`  NOTE: Selection fix is in renderer, not geometry processing.`);
    console.log(`        Check scene.ts getMeshData() merges all pieces.`);
  }
  console.log();

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const coveringFixed = coveringMeshes.length > 0 && !coveringMeshes.some(m => m.hasSpikes);
  const wallFixed = wallMeshes.length > 0 && wallMeshes.some(m => m.triangleCount > 50);

  console.log(`1. Covering spikes: ${coveringFixed ? '✅ FIXED' : '❌ NOT FIXED'}`);
  console.log(`2. Wall openings: ${wallFixed ? '✅ LIKELY FIXED' : '❌ NOT FIXED (need visual verification)'}`);
  console.log(`3. Window selection: Requires visual verification in browser`);
  console.log();
}

function analyzeForSpikes(positions: Float32Array, indices: Uint32Array): { hasSpikes: boolean; spikeDetails?: string } {
  // Calculate bounding box diagonal as reference for "normal" edge length
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v];
    const y = positions[v + 1];
    const z = positions[v + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  const diagonal = Math.sqrt(
    Math.pow(maxX - minX, 2) +
    Math.pow(maxY - minY, 2) +
    Math.pow(maxZ - minZ, 2)
  );

  // An edge is considered a "spike" if it's longer than 80% of the bounding box diagonal
  const spikeThreshold = diagonal * 0.8;

  let spikeCount = 0;
  let maxEdgeLength = 0;
  let spikeTriangles: number[] = [];

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];

    const v0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
    const v1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
    const v2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

    const edge1 = Math.sqrt(Math.pow(v1[0] - v0[0], 2) + Math.pow(v1[1] - v0[1], 2) + Math.pow(v1[2] - v0[2], 2));
    const edge2 = Math.sqrt(Math.pow(v2[0] - v1[0], 2) + Math.pow(v2[1] - v1[1], 2) + Math.pow(v2[2] - v1[2], 2));
    const edge3 = Math.sqrt(Math.pow(v0[0] - v2[0], 2) + Math.pow(v0[1] - v2[1], 2) + Math.pow(v0[2] - v2[2], 2));

    const maxEdge = Math.max(edge1, edge2, edge3);
    maxEdgeLength = Math.max(maxEdgeLength, maxEdge);

    if (maxEdge > spikeThreshold) {
      spikeCount++;
      if (spikeTriangles.length < 5) {
        spikeTriangles.push(t / 3);
      }
    }
  }

  if (spikeCount > 0) {
    return {
      hasSpikes: true,
      spikeDetails: `${spikeCount} triangles with edges > ${spikeThreshold.toFixed(3)} (threshold 80% of diagonal ${diagonal.toFixed(3)}). Max edge: ${maxEdgeLength.toFixed(3)}. First spike triangles: ${spikeTriangles.join(', ')}`,
    };
  }

  return { hasSpikes: false };
}

// Run
main().catch(console.error);
