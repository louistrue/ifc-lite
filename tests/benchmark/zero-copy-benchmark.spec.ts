import { test, expect } from '@playwright/test';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

interface ZeroCopyResults {
  copy: {
    method: string;
    copies: number;
    parseTime: number;
    uploadTime: number;
    renderTime: number;
    totalTime: number;
    vertices?: number;
    triangles?: number;
    dataSize?: number;
    heapGrowth?: number;
    peakHeap?: number;
  };
  zeroCopy: {
    method: string;
    copies: number;
    parseTime: number;
    uploadTime: number;
    renderTime: number;
    totalTime: number;
    vertices?: number;
    triangles?: number;
    dataSize?: number;
    heapGrowth?: number;
    peakHeap?: number;
  };
  improvement: {
    parseTime: number;
    uploadTime: number;
    totalTime: number;
  };
}

test.describe('Zero-Copy Benchmark', () => {
  // Get IFC files from environment variable or use defaults
  const ifcFilesEnv = process.env.IFC_FILES;
  const ifcFiles = ifcFilesEnv
    ? ifcFilesEnv.split(',').map((f) => f.trim())
    : [
        'tests/benchmark/models/ara3d/AC20-FZK-Haus.ifc',
        'tests/benchmark/models/ara3d/IfcOpenHouse_IFC4.ifc',
        'tests/benchmark/models/ara3d/duplex.ifc',
      ];

  for (const ifcFile of ifcFiles) {
    test(`zero-copy benchmark ${ifcFile}`, async ({ page }) => {
      const fileName = ifcFile.split('/').pop() || 'unknown';

      // Navigate to zero-copy benchmark page
      await page.goto('/tests/benchmark/zero-copy-benchmark.html');

      // Wait for page to initialize
      await page.waitForSelector('[data-testid="file-input"]');

      // Wait for WASM to initialize
      await page.waitForFunction(
        () => {
          const log = document.getElementById('log');
          return log && log.textContent?.includes('IFC-Lite ready');
        },
        { timeout: 30000 }
      );

      // Load IFC file
      const filePath = join(process.cwd(), ifcFile);
      if (!existsSync(filePath)) {
        console.log(`Skipping ${fileName} - file not found at ${filePath}`);
        return;
      }

      const fileInput = page.locator('[data-testid="file-input"]');
      await fileInput.setInputFiles(filePath);

      // Wait for file to load
      await page.waitForFunction(() => {
        const log = document.getElementById('log');
        return log && log.textContent?.includes('File loaded');
      });

      // Click run benchmark button
      const runButton = page.locator('[data-testid="run-benchmark"]');
      await expect(runButton).toBeEnabled();
      await runButton.click();

      // Wait for benchmark to complete
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="benchmark-complete"]');
          return el && el.getAttribute('data-complete') === 'true';
        },
        { timeout: 120000 }
      );

      // Extract results
      const resultsElement = page.locator('[data-testid="benchmark-complete"]');
      const resultsJson = await resultsElement.getAttribute('data-results');

      if (!resultsJson) {
        throw new Error('Benchmark results not found');
      }

      const results: ZeroCopyResults = JSON.parse(resultsJson);

      // Log results
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Zero-Copy Benchmark Results: ${fileName}`);
      console.log(`${'='.repeat(60)}`);

      console.log(`\n--- Traditional (Copy) ---`);
      console.log(`  Total Time: ${results.copy.totalTime.toFixed(1)}ms`);
      console.log(`  Parse Time: ${results.copy.parseTime.toFixed(1)}ms`);
      console.log(`  Upload Time: ${results.copy.uploadTime.toFixed(1)}ms`);
      console.log(`  Render Time: ${results.copy.renderTime.toFixed(1)}ms`);
      console.log(`  Data Copies: ${results.copy.copies}`);
      if (results.copy.vertices) {
        console.log(`  Vertices: ${results.copy.vertices.toLocaleString()}`);
        console.log(`  Triangles: ${results.copy.triangles?.toLocaleString()}`);
      }
      if (results.copy.peakHeap) {
        console.log(`  Peak Heap: ${(results.copy.peakHeap / 1024 / 1024).toFixed(2)} MB`);
      }

      console.log(`\n--- Zero-Copy (New) ---`);
      console.log(`  Total Time: ${results.zeroCopy.totalTime.toFixed(1)}ms`);
      console.log(`  Parse Time: ${results.zeroCopy.parseTime.toFixed(1)}ms`);
      console.log(`  Upload Time: ${results.zeroCopy.uploadTime.toFixed(1)}ms`);
      console.log(`  Render Time: ${results.zeroCopy.renderTime.toFixed(1)}ms`);
      console.log(`  Data Copies: ${results.zeroCopy.copies}`);
      if (results.zeroCopy.vertices) {
        console.log(`  Vertices: ${results.zeroCopy.vertices.toLocaleString()}`);
        console.log(`  Triangles: ${results.zeroCopy.triangles?.toLocaleString()}`);
      }
      if (results.zeroCopy.peakHeap) {
        console.log(`  Peak Heap: ${(results.zeroCopy.peakHeap / 1024 / 1024).toFixed(2)} MB`);
      }

      console.log(`\n--- Improvement ---`);
      console.log(`  Parse Time: ${results.improvement.parseTime.toFixed(1)}% faster`);
      console.log(`  Upload Time: ${results.improvement.uploadTime.toFixed(1)}% faster`);
      console.log(`  Total Time: ${results.improvement.totalTime.toFixed(1)}% faster`);

      const speedup = results.copy.totalTime / results.zeroCopy.totalTime;
      console.log(`  Speedup: ${speedup.toFixed(2)}x`);

      if (results.copy.peakHeap && results.zeroCopy.peakHeap) {
        const memReduction = ((results.copy.peakHeap - results.zeroCopy.peakHeap) / results.copy.peakHeap) * 100;
        console.log(`  Memory Reduction: ${memReduction.toFixed(1)}%`);
      }

      console.log(`${'='.repeat(60)}\n`);

      // Save results to file
      const outputDir = join(process.cwd(), 'benchmark-results');
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const outputPath = join(outputDir, `zero-copy-${fileName.replace('.ifc', '')}.json`);
      const outputData = {
        fileName,
        filePath: ifcFile,
        timestamp: new Date().toISOString(),
        results,
        summary: {
          speedup,
          totalTimeImprovement: results.improvement.totalTime,
          parseTimeImprovement: results.improvement.parseTime,
          uploadTimeImprovement: results.improvement.uploadTime,
          memorySaved: results.copy.peakHeap && results.zeroCopy.peakHeap
            ? ((results.copy.peakHeap - results.zeroCopy.peakHeap) / results.copy.peakHeap) * 100
            : null,
        },
      };
      writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
      console.log(`Results saved to ${outputPath}`);

      // Assertions
      expect(results.copy.totalTime).toBeGreaterThan(0);
      expect(results.zeroCopy.totalTime).toBeGreaterThan(0);

      // Zero-copy should have fewer copies
      expect(results.zeroCopy.copies).toBeLessThan(results.copy.copies);

      // Zero-copy should be faster (at least for upload)
      // Note: Parse time might be similar or slightly different due to different code paths
      // Upload time should be significantly improved with zero-copy
    });
  }

  test('zero-copy benchmark with multiple iterations', async ({ page }) => {
    const testFile = 'tests/benchmark/models/ara3d/AC20-FZK-Haus.ifc';
    const fileName = testFile.split('/').pop() || 'unknown';
    const filePath = join(process.cwd(), testFile);

    if (!existsSync(filePath)) {
      console.log(`Skipping iteration test - file not found at ${filePath}`);
      return;
    }

    // Navigate to benchmark page
    await page.goto('/tests/benchmark/zero-copy-benchmark.html');

    // Wait for WASM to initialize
    await page.waitForFunction(
      () => {
        const log = document.getElementById('log');
        return log && log.textContent?.includes('IFC-Lite ready');
      },
      { timeout: 30000 }
    );

    // Load file
    const fileInput = page.locator('[data-testid="file-input"]');
    await fileInput.setInputFiles(filePath);

    await page.waitForFunction(() => {
      const log = document.getElementById('log');
      return log && log.textContent?.includes('File loaded');
    });

    // Run 5 iterations for averaged results
    const iterButton = page.locator('[data-testid="run-iterations"]');
    await expect(iterButton).toBeEnabled();
    await iterButton.click();

    // Wait for completion (longer timeout for 5 iterations)
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="benchmark-complete"]');
        return el && el.getAttribute('data-complete') === 'true';
      },
      { timeout: 300000 }
    );

    // Extract averaged results
    const resultsElement = page.locator('[data-testid="benchmark-complete"]');
    const resultsJson = await resultsElement.getAttribute('data-results');

    if (!resultsJson) {
      throw new Error('Averaged benchmark results not found');
    }

    const results: ZeroCopyResults = JSON.parse(resultsJson);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`AVERAGED Zero-Copy Results (5 iterations): ${fileName}`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Traditional Total: ${results.copy.totalTime.toFixed(1)}ms`);
    console.log(`Zero-Copy Total: ${results.zeroCopy.totalTime.toFixed(1)}ms`);
    console.log(`Improvement: ${results.improvement.totalTime.toFixed(1)}%`);
    console.log(`${'='.repeat(60)}\n`);

    // Save averaged results
    const outputDir = join(process.cwd(), 'benchmark-results');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = join(outputDir, `zero-copy-averaged-${fileName.replace('.ifc', '')}.json`);
    writeFileSync(
      outputPath,
      JSON.stringify(
        {
          fileName,
          iterations: 5,
          timestamp: new Date().toISOString(),
          results,
        },
        null,
        2
      )
    );

    expect(results.copy.totalTime).toBeGreaterThan(0);
    expect(results.zeroCopy.totalTime).toBeGreaterThan(0);
  });
});
