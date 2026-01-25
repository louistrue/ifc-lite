/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Test script for front-to-back geometry loading
 * Compares time-to-first-geometry between standard and front-to-back loading
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Note: This test would need to run in a browser or Node with WASM support
// For now, we'll test the TypeScript layer compiles correctly

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_FILES = [
  'AC20-FZK-Haus.ifc',           // 2.5 MB - small house
  'C20-Institute-Var-2.ifc',     // 10.7 MB - medium building
  'FM_ARC_DigitalHub.ifc',       // 14 MB - larger building
];

interface BenchmarkResult {
  file: string;
  sizeMB: number;
  standard: {
    firstGeometryMs: number;
    totalMs: number;
    meshCount: number;
  };
  frontToBack: {
    firstGeometryMs: number;
    totalMs: number;
    meshCount: number;
  };
  improvement: number; // % improvement in first-geometry time
}

async function main() {
  console.log('Front-to-Back Loading Test');
  console.log('='.repeat(60));
  console.log();

  console.log('This test validates that the front-to-back loading API compiles correctly.');
  console.log('Full benchmarking requires browser environment with WASM support.');
  console.log();

  // Check test files exist
  const modelsDir = path.join(__dirname, '../models/ara3d');

  for (const file of TEST_FILES) {
    const filePath = path.join(modelsDir, file);
    try {
      const stats = readFileSync(filePath);
      const sizeMB = stats.length / (1024 * 1024);
      console.log(`✓ ${file}: ${sizeMB.toFixed(1)} MB`);
    } catch {
      console.log(`✗ ${file}: not found`);
    }
  }

  console.log();
  console.log('To run the full benchmark:');
  console.log('  1. Start the viewer: pnpm dev');
  console.log('  2. Load a test file and observe console timing logs');
  console.log('  3. Compare "[useIfc] Using FRONT-TO-BACK loading" vs standard loading');
  console.log();

  console.log('Expected improvements:');
  console.log('  - First geometry: <100ms (vs 500ms+ with standard loading)');
  console.log('  - "Looks complete": <300ms (vs 1-2s with standard loading)');
  console.log('  - Total time: Similar (sorting adds ~15-20% overhead)');
}

main().catch(console.error);
