import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface BenchmarkResults {
  ifcLite: {
    parseTime: number;
    uploadTime: number;
    renderTime: number;
    totalTime: number;
    vertices: number;
    triangles: number;
    fps?: number;
  };
  webIfc: {
    parseTime: number;
    uploadTime: number;
    renderTime: number;
    totalTime: number;
    vertices: number;
    triangles: number;
    fps?: number;
  };
  speedup: number;
}

test.describe('IFC Benchmark', () => {
  // Get IFC files from environment variable or use defaults
  const ifcFilesEnv = process.env.IFC_FILES;
  const ifcFiles = ifcFilesEnv
    ? ifcFilesEnv.split(',').map(f => f.trim())
    : [
        'tests/benchmark/models/ara3d/AC20-FZK-Haus.ifc',
        'tests/benchmark/models/ara3d/IfcOpenHouse_IFC4.ifc',
      ];

  for (const ifcFile of ifcFiles) {
    test(`benchmark ${ifcFile}`, async ({ page }) => {
      const fileName = ifcFile.split('/').pop() || 'unknown';
      
      // Navigate to benchmark page
      await page.goto('/tests/benchmark/browser-benchmark.html');
      
      // Wait for page to initialize
      await page.waitForSelector('[data-testid="file-input"]');
      
      // Wait for APIs to initialize (check for ready state)
      await page.waitForFunction(() => {
        const log = document.getElementById('log');
        return log && log.textContent?.includes('web-ifc ready');
      }, { timeout: 30000 });

      // Load IFC file
      const filePath = join(process.cwd(), ifcFile);
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

      // Wait for benchmark to complete (element may be hidden, just check for attribute)
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="benchmark-complete"]');
        return el && el.getAttribute('data-complete') === 'true';
      }, { timeout: 120000 });

      // Extract results
      const resultsElement = page.locator('[data-testid="benchmark-complete"]');
      const resultsJson = await resultsElement.getAttribute('data-results');
      
      if (!resultsJson) {
        throw new Error('Benchmark results not found');
      }

      const results: BenchmarkResults = JSON.parse(resultsJson);

      // Extract stats from DOM for verification
      const ifcLiteStats = await page.locator('[data-testid="stats-ifc-lite"]').getAttribute('data-stats');
      const webIfcStats = await page.locator('[data-testid="stats-web-ifc"]').getAttribute('data-stats');

      // Log results
      console.log(`\n=== Benchmark Results: ${fileName} ===`);
      console.log(`IFC-Lite: ${results.ifcLite.totalTime.toFixed(1)}ms total`);
      console.log(`  Parse: ${results.ifcLite.parseTime.toFixed(1)}ms`);
      console.log(`  Upload: ${results.ifcLite.uploadTime.toFixed(1)}ms`);
      console.log(`  Render: ${results.ifcLite.renderTime.toFixed(1)}ms`);
      console.log(`  Vertices: ${results.ifcLite.vertices.toLocaleString()}`);
      console.log(`  Triangles: ${results.ifcLite.triangles.toLocaleString()}`);
      console.log(`web-ifc: ${results.webIfc.totalTime.toFixed(1)}ms total`);
      console.log(`  Parse: ${results.webIfc.parseTime.toFixed(1)}ms`);
      console.log(`  Upload: ${results.webIfc.uploadTime.toFixed(1)}ms`);
      console.log(`  Render: ${results.webIfc.renderTime.toFixed(1)}ms`);
      console.log(`  Vertices: ${results.webIfc.vertices.toLocaleString()}`);
      console.log(`  Triangles: ${results.webIfc.triangles.toLocaleString()}`);
      console.log(`Speedup: ${results.speedup.toFixed(2)}x (IFC-Lite ${results.speedup > 1 ? 'faster' : 'slower'})`);

      // Save results to file if output path specified
      const outputPath = process.env.BENCHMARK_OUTPUT;
      if (outputPath) {
        const outputData = {
          fileName,
          filePath: ifcFile,
          timestamp: new Date().toISOString(),
          results,
        };
        writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
        console.log(`Results saved to ${outputPath}`);
      }

      // Verify results are valid
      expect(results.ifcLite.totalTime).toBeGreaterThan(0);
      expect(results.webIfc.totalTime).toBeGreaterThan(0);
      expect(results.ifcLite.vertices).toBeGreaterThan(0);
      expect(results.webIfc.vertices).toBeGreaterThan(0);
    });
  }
});
