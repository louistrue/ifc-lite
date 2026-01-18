/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test, expect } from '@playwright/test';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { ViewerBenchmarkPage, ViewerBenchmarkMetrics } from './viewer-benchmark-page';

interface ViewerBenchmarkResult {
  file: string;
  sizeMB: number;
  timestamp: string;
  metrics: ViewerBenchmarkMetrics;
  thresholds: {
    passed: boolean;
    violations: string[];
  };
}

interface Baseline {
  [fileName: string]: {
    metrics: ViewerBenchmarkMetrics;
    timestamp: string;
  };
}

interface ThresholdConfig {
  firstBatchWait: number; // percentage increase allowed
  geometryStreaming: number;
  entityScan: number;
  dataModelParse: number;
}

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  firstBatchWait: 50, // +50% (allow for system variance)
  geometryStreaming: 50, // +50%
  entityScan: 50, // +50%
  dataModelParse: 50, // +50%
};

function loadBaseline(): Baseline {
  const baselinePath = join(process.cwd(), 'tests/benchmark/baseline.json');
  if (existsSync(baselinePath)) {
    try {
      return JSON.parse(readFileSync(baselinePath, 'utf-8'));
    } catch (e) {
      console.warn('Failed to load baseline, starting fresh');
      return {};
    }
  }
  return {};
}

function checkThresholds(
  metrics: ViewerBenchmarkMetrics,
  baseline: ViewerBenchmarkMetrics | null,
  thresholds: ThresholdConfig
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (!baseline) {
    // No baseline, skip threshold checks
    return { passed: true, violations: [] };
  }

  // Check first batch wait
  if (metrics.firstBatchWaitMs !== null && baseline.firstBatchWaitMs !== null) {
    const increase = ((metrics.firstBatchWaitMs - baseline.firstBatchWaitMs) / baseline.firstBatchWaitMs) * 100;
    if (increase > thresholds.firstBatchWait) {
      violations.push(
        `First batch wait increased by ${increase.toFixed(1)}% (${metrics.firstBatchWaitMs}ms vs ${baseline.firstBatchWaitMs}ms baseline)`
      );
    }
  }

  // Check geometry streaming
  if (metrics.geometryStreamingMs !== null && baseline.geometryStreamingMs !== null) {
    const increase = ((metrics.geometryStreamingMs - baseline.geometryStreamingMs) / baseline.geometryStreamingMs) * 100;
    if (increase > thresholds.geometryStreaming) {
      violations.push(
        `Geometry streaming increased by ${increase.toFixed(1)}% (${metrics.geometryStreamingMs}ms vs ${baseline.geometryStreamingMs}ms baseline)`
      );
    }
  }

  // Check entity scan
  if (metrics.entityScanMs !== null && baseline.entityScanMs !== null) {
    const increase = ((metrics.entityScanMs - baseline.entityScanMs) / baseline.entityScanMs) * 100;
    if (increase > thresholds.entityScan) {
      violations.push(
        `Entity scan increased by ${increase.toFixed(1)}% (${metrics.entityScanMs}ms vs ${baseline.entityScanMs}ms baseline)`
      );
    }
  }

  // Check data model parse
  if (metrics.dataModelParseMs !== null && baseline.dataModelParseMs !== null) {
    const increase = ((metrics.dataModelParseMs - baseline.dataModelParseMs) / baseline.dataModelParseMs) * 100;
    if (increase > thresholds.dataModelParse) {
      violations.push(
        `Data model parse increased by ${increase.toFixed(1)}% (${metrics.dataModelParseMs}ms vs ${baseline.dataModelParseMs}ms baseline)`
      );
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

test.describe('Viewer Performance Benchmarks', () => {
  // Get IFC files from environment variable or use defaults
  const ifcFilesEnv = process.env.VIEWER_BENCHMARK_FILES;
  const ifcFiles = ifcFilesEnv
    ? ifcFilesEnv.split(',').map((f) => f.trim())
    : [
        'tests/models/O-S1-BWK-BIM architectural - BIM bouwkundig.ifc',
        'tests/models/01_Snowdon_Towers_Sample_Structural(1).ifc',
        'tests/models/ara3d/ISSUE_053_20181220Holter_Tower_10.ifc',
      ];

  const baseline = loadBaseline();
  const thresholds = DEFAULT_THRESHOLDS;

  for (const ifcFile of ifcFiles) {
    test(`benchmark ${ifcFile}`, async ({ page }) => {
      const fileName = ifcFile.split('/').pop() || 'unknown';
      const filePath = join(process.cwd(), ifcFile);

      // Skip if file doesn't exist
      if (!existsSync(filePath)) {
        console.log(`Skipping ${fileName} - file not found at ${filePath}`);
        test.skip();
        return;
      }

      const benchmarkPage = new ViewerBenchmarkPage(page);
      await benchmarkPage.setup();

      // Load file
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Loading ${fileName}...`);
      console.log(`${'='.repeat(80)}`);

      await benchmarkPage.loadFile(filePath);

      // Wait for completion (long timeout for large files)
      const fileSizeMB = (await import('fs')).statSync(filePath).size / (1024 * 1024);
      const timeoutMs = fileSizeMB > 200 ? 600000 : fileSizeMB > 50 ? 300000 : 180000; // 10min / 5min / 3min

      console.log(`Waiting for completion (timeout: ${timeoutMs / 1000}s)...`);
      await benchmarkPage.waitForCompletion(timeoutMs);

      // Extract metrics
      const metrics = benchmarkPage.getMetrics();

      // Get baseline for this file
      const baselineMetrics = baseline[fileName]?.metrics || null;

      // Check thresholds
      const thresholdResult = checkThresholds(metrics, baselineMetrics, thresholds);

      // Log results
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Benchmark Results: ${fileName}`);
      console.log(`${'='.repeat(80)}`);
      console.log(`\nFile Size: ${metrics.fileSizeMB?.toFixed(2) || 'N/A'} MB`);
      
      // TOTAL TIME - the most important metric
      console.log(`\n>>> TOTAL WALL-CLOCK TIME: ${metrics.totalWallClockMs?.toFixed(0) || 'N/A'} ms (${((metrics.totalWallClockMs || 0) / 1000).toFixed(1)}s) <<<`);
      console.log(`    File Read: ${metrics.fileReadMs?.toFixed(0) || 'N/A'} ms`);
      
      console.log(`\n--- Geometry Streaming ---`);
      console.log(`  Model Open: ${metrics.modelOpenMs?.toFixed(0) || 'N/A'} ms`);
      console.log(`  First Batch Wait: ${metrics.firstBatchWaitMs?.toFixed(0) || 'N/A'} ms`);
      console.log(`  First Batch Meshes: ${metrics.firstBatchMeshes?.toLocaleString() || 'N/A'}`);
      console.log(`  Total Batches: ${metrics.totalBatches?.toLocaleString() || 'N/A'}`);
      console.log(`  Total Meshes: ${metrics.totalMeshes?.toLocaleString() || 'N/A'}`);
      console.log(`  Geometry Streaming Total: ${metrics.geometryStreamingMs?.toFixed(0) || 'N/A'} ms`);
      console.log(`  WASM Wait: ${metrics.wasmWaitMs?.toFixed(0) || 'N/A'} ms`);
      console.log(`  JS Process: ${metrics.jsProcessMs?.toFixed(0) || 'N/A'} ms`);

      console.log(`\n--- Data Model Parsing ---`);
      console.log(`  Entity Scan: ${metrics.entityScanMs?.toFixed(0) || 'N/A'} ms`);
      console.log(`  Entity Count: ${metrics.entityCount?.toLocaleString() || 'N/A'}`);
      console.log(`  Data Model Parse: ${metrics.dataModelParseMs?.toFixed(0) || 'N/A'} ms`);
      console.log(`  Data Model Entities: ${metrics.dataModelEntityCount?.toLocaleString() || 'N/A'}`);

      if (baselineMetrics) {
        console.log(`\n--- Comparison with Baseline ---`);
        if (metrics.firstBatchWaitMs !== null && baselineMetrics.firstBatchWaitMs !== null) {
          const diff = metrics.firstBatchWaitMs - baselineMetrics.firstBatchWaitMs;
          const pct = ((diff / baselineMetrics.firstBatchWaitMs) * 100).toFixed(1);
          console.log(`  First Batch Wait: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}ms (${pct > 0 ? '+' : ''}${pct}%)`);
        }
        if (metrics.geometryStreamingMs !== null && baselineMetrics.geometryStreamingMs !== null) {
          const diff = metrics.geometryStreamingMs - baselineMetrics.geometryStreamingMs;
          const pct = ((diff / baselineMetrics.geometryStreamingMs) * 100).toFixed(1);
          console.log(`  Geometry Streaming: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}ms (${pct > 0 ? '+' : ''}${pct}%)`);
        }
        if (metrics.entityScanMs !== null && baselineMetrics.entityScanMs !== null) {
          const diff = metrics.entityScanMs - baselineMetrics.entityScanMs;
          const pct = ((diff / baselineMetrics.entityScanMs) * 100).toFixed(1);
          console.log(`  Entity Scan: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}ms (${pct > 0 ? '+' : ''}${pct}%)`);
        }
        if (metrics.dataModelParseMs !== null && baselineMetrics.dataModelParseMs !== null) {
          const diff = metrics.dataModelParseMs - baselineMetrics.dataModelParseMs;
          const pct = ((diff / baselineMetrics.dataModelParseMs) * 100).toFixed(1);
          console.log(`  Data Model Parse: ${diff > 0 ? '+' : ''}${diff.toFixed(0)}ms (${pct > 0 ? '+' : ''}${pct}%)`);
        }
      } else {
        console.log(`\n--- No Baseline Available ---`);
        console.log(`  This run will be used as the baseline for future comparisons.`);
      }

      if (thresholdResult.violations.length > 0) {
        console.log(`\n--- Threshold Violations ---`);
        thresholdResult.violations.forEach((v) => console.log(`  ⚠ ${v}`));
      }

      console.log(`${'='.repeat(80)}\n`);

      // Save results
      const outputDir = join(process.cwd(), 'tests/benchmark/benchmark-results');
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const result: ViewerBenchmarkResult = {
        file: fileName,
        sizeMB: metrics.fileSizeMB || 0,
        timestamp: new Date().toISOString(),
        metrics,
        thresholds: thresholdResult,
      };

      const outputPath = join(outputDir, `viewer-${fileName.replace(/[^a-zA-Z0-9]/g, '_')}.json`);
      writeFileSync(outputPath, JSON.stringify(result, null, 2));
      console.log(`Results saved to ${outputPath}`);

      // Assertions
      expect(metrics.modelOpenMs).not.toBeNull();
      expect(metrics.totalMeshes).toBeGreaterThan(0);

      // Fail if thresholds violated
      if (!thresholdResult.passed) {
        throw new Error(`Performance regression detected:\n${thresholdResult.violations.join('\n')}`);
      }
    });
  }
});
