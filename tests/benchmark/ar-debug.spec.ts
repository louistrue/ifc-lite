/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Playwright test for AR.ifc geometry issues
 *
 * Tests:
 * 1. Covering geometry - no spikes (ear-clipping triangulation fix)
 * 2. Wall openings - properly cut (compound wall fix)
 * 3. Window selection - all parts highlighted (merge fix)
 *
 * Run: npx playwright test tests/debug-ar-geometry.spec.ts --headed
 */

import { test, expect } from '@playwright/test';
import { existsSync } from 'fs';
import { join } from 'path';

const AR_FILE = 'tests/models/local/AR.ifc';

// Target express IDs from IFC file
const TARGET_EXPRESS_IDS = {
  covering: 739996,  // IfcCovering with spikes issue
  wall: 443610,      // IfcWall with openings not cut
  window: 469622,    // IfcWindow multi-part selection issue
};

test.describe('AR.ifc Geometry Debug', () => {
  test.beforeEach(async ({ page }) => {
    // Skip if file doesn't exist
    const filePath = join(process.cwd(), AR_FILE);
    if (!existsSync(filePath)) {
      console.log(`Skipping - file not found at ${filePath}`);
      test.skip();
      return;
    }
  });

  test('debug geometry issues', async ({ page }) => {
    const filePath = join(process.cwd(), AR_FILE);

    // Capture console messages
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    // Navigate to viewer
    console.log('\n' + '='.repeat(80));
    console.log('Loading AR.ifc for geometry debugging...');
    console.log('='.repeat(80) + '\n');

    await page.goto('http://localhost:3000');
    await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 30000 });

    // Load file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(filePath);
    console.log('File uploaded, waiting for processing...\n');

    // Wait for model to load (look for element count in status bar)
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      return text.includes('elements') && text.includes('tris');
    }, { timeout: 300000 });

    console.log('Model loaded!\n');

    // Wait a bit for rendering to settle
    await page.waitForTimeout(3000);

    // Press H for home view to reset camera
    await page.keyboard.press('h');
    await page.waitForTimeout(2000);

    // Take initial screenshot
    const screenshotPath1 = join(process.cwd(), 'tests', 'debug-ar-geometry-home.png');
    await page.screenshot({ path: screenshotPath1, fullPage: false });
    console.log(`Home view screenshot: ${screenshotPath1}`);

    // Search for the wall element to navigate to it
    const searchBox = page.locator('input[placeholder*="Search"]').first();
    if (await searchBox.count() > 0) {
      await searchBox.click();
      await searchBox.fill('WAL_EXT_AR_200mm');
      await page.waitForTimeout(1000);
    }

    // Inject debug script to analyze meshes
    const analysisResult = await page.evaluate((targetIds) => {
      // Access the viewer's internal state
      // @ts-ignore - accessing internal state
      const viewerStore = window.__VIEWER_STORE__;
      if (!viewerStore) {
        return { error: 'Viewer store not found' };
      }

      const state = viewerStore.getState();
      const scene = state.scene;

      if (!scene) {
        return { error: 'Scene not found' };
      }

      const results: Record<string, any> = {};

      // Analyze each target entity
      for (const [name, expressId] of Object.entries(targetIds)) {
        const pieces = scene.getMeshDataPieces?.(expressId);
        const merged = scene.getMeshData?.(expressId);

        if (!pieces && !merged) {
          results[name] = { found: false };
          continue;
        }

        const pieceCount = pieces?.length || 0;
        const totalVertices = pieces?.reduce((sum: number, p: any) => sum + p.positions.length / 3, 0) || 0;
        const totalTriangles = pieces?.reduce((sum: number, p: any) => sum + p.indices.length / 3, 0) || 0;

        // Check for spikes in covering
        let hasSpikes = false;
        let spikeInfo = '';
        if (name === 'covering' && pieces) {
          for (const piece of pieces) {
            const { positions, indices } = piece;

            // Calculate bounding box diagonal
            let minX = Infinity, minY = Infinity, minZ = Infinity;
            let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

            for (let v = 0; v < positions.length; v += 3) {
              minX = Math.min(minX, positions[v]);
              minY = Math.min(minY, positions[v + 1]);
              minZ = Math.min(minZ, positions[v + 2]);
              maxX = Math.max(maxX, positions[v]);
              maxY = Math.max(maxY, positions[v + 1]);
              maxZ = Math.max(maxZ, positions[v + 2]);
            }

            const diagonal = Math.sqrt(
              Math.pow(maxX - minX, 2) +
              Math.pow(maxY - minY, 2) +
              Math.pow(maxZ - minZ, 2)
            );

            const spikeThreshold = diagonal * 0.8;

            // Check for long edges (spikes)
            for (let t = 0; t < indices.length; t += 3) {
              const i0 = indices[t], i1 = indices[t + 1], i2 = indices[t + 2];
              const v0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
              const v1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
              const v2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

              const edge1 = Math.sqrt(Math.pow(v1[0] - v0[0], 2) + Math.pow(v1[1] - v0[1], 2) + Math.pow(v1[2] - v0[2], 2));
              const edge2 = Math.sqrt(Math.pow(v2[0] - v1[0], 2) + Math.pow(v2[1] - v1[1], 2) + Math.pow(v2[2] - v1[2], 2));
              const edge3 = Math.sqrt(Math.pow(v0[0] - v2[0], 2) + Math.pow(v0[1] - v2[1], 2) + Math.pow(v0[2] - v2[2], 2));

              const maxEdge = Math.max(edge1, edge2, edge3);
              if (maxEdge > spikeThreshold) {
                hasSpikes = true;
                spikeInfo = `Triangle ${t / 3} has edge length ${maxEdge.toFixed(3)} > threshold ${spikeThreshold.toFixed(3)}`;
                break;
              }
            }
            if (hasSpikes) break;
          }
        }

        results[name] = {
          found: true,
          expressId,
          pieceCount,
          totalVertices,
          totalTriangles,
          hasSpikes,
          spikeInfo,
        };
      }

      return results;
    }, TARGET_EXPRESS_IDS);

    console.log('='.repeat(80));
    console.log('GEOMETRY ANALYSIS RESULTS');
    console.log('='.repeat(80) + '\n');

    if (analysisResult.error) {
      console.log('ERROR:', analysisResult.error);
      console.log('\nThis may be because the viewer store is not exposed.');
      console.log('Attempting visual verification instead...\n');
    } else {
      // Print results
      console.log('1. COVERING GEOMETRY (spikes fix):');
      const covering = analysisResult.covering;
      if (covering?.found) {
        console.log(`   Express ID: ${covering.expressId}`);
        console.log(`   Pieces: ${covering.pieceCount}`);
        console.log(`   Vertices: ${covering.totalVertices}`);
        console.log(`   Triangles: ${covering.totalTriangles}`);
        console.log(`   HAS SPIKES: ${covering.hasSpikes ? 'YES ❌' : 'NO ✅'}`);
        if (covering.spikeInfo) console.log(`   Spike info: ${covering.spikeInfo}`);
      } else {
        console.log('   NOT FOUND');
      }
      console.log();

      console.log('2. WALL OPENINGS (compound wall fix):');
      const wall = analysisResult.wall;
      if (wall?.found) {
        console.log(`   Express ID: ${wall.expressId}`);
        console.log(`   Pieces: ${wall.pieceCount}`);
        console.log(`   Vertices: ${wall.totalVertices}`);
        console.log(`   Triangles: ${wall.totalTriangles}`);
        // With 8 openings properly cut, expect many more triangles
        const likelyCut = wall.totalTriangles > 100;
        console.log(`   OPENINGS LIKELY CUT: ${likelyCut ? 'YES ✅' : 'NO ❌'} (${wall.totalTriangles} triangles)`);
      } else {
        console.log('   NOT FOUND');
      }
      console.log();

      console.log('3. WINDOW SELECTION (multi-part merge fix):');
      const windowResult = analysisResult.window;
      if (windowResult?.found) {
        console.log(`   Express ID: ${windowResult.expressId}`);
        console.log(`   Pieces: ${windowResult.pieceCount}`);
        console.log(`   Vertices: ${windowResult.totalVertices}`);
        console.log(`   Triangles: ${windowResult.totalTriangles}`);
        console.log(`   MULTI-PART: ${windowResult.pieceCount > 1 ? 'YES' : 'NO'} (${windowResult.pieceCount} pieces)`);
        console.log('   NOTE: Selection merging is tested by clicking in browser');
      } else {
        console.log('   NOT FOUND');
      }
      console.log();
    }

    // Take a screenshot for visual verification
    const screenshotPath = join(process.cwd(), 'tests', 'debug-ar-geometry-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    // Keep browser open for manual inspection
    console.log('\n' + '='.repeat(80));
    console.log('Browser will stay open for 60 seconds for manual inspection.');
    console.log('Check:');
    console.log('  1. Coverings for spike artifacts');
    console.log('  2. Walls for proper window/door cutouts');
    console.log('  3. Click a window and verify ALL parts highlight');
    console.log('='.repeat(80) + '\n');

    await page.waitForTimeout(60000);
  });
});
