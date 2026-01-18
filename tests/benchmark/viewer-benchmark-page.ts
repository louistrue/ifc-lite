/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Page, ConsoleMessage } from '@playwright/test';

export interface ViewerBenchmarkMetrics {
  modelOpenMs: number | null;
  firstBatchWaitMs: number | null;
  firstBatchNumber: number | null;
  firstBatchMeshes: number | null;
  totalBatches: number | null;
  totalMeshes: number | null;
  geometryStreamingMs: number | null;
  wasmWaitMs: number | null;
  jsProcessMs: number | null;
  entityScanMs: number | null;
  entityCount: number | null;
  dataModelParseMs: number | null;
  dataModelEntityCount: number | null;
  fileSizeMB: number | null;
}

export class ViewerBenchmarkPage {
  private page: Page;
  private consoleLogs: string[] = [];
  private metrics: Partial<ViewerBenchmarkMetrics> = {};

  constructor(page: Page) {
    this.page = page;
  }

  async setup() {
    // Capture all console logs
    this.page.on('console', (msg: ConsoleMessage) => {
      const text = msg.text();
      this.consoleLogs.push(text);
    });

    // Navigate to viewer app
    await this.page.goto('http://localhost:3000');
    
    // Wait for app to be ready (file input exists but is hidden, so check for existence)
    await this.page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 30000 });
    
    // Also wait for the app to be interactive
    await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      // Ignore if networkidle times out, app might still be loading
    });
  }

  async loadFile(filePath: string) {
    // Find the file input (there are two, use the one in ViewportContainer)
    const fileInput = this.page.locator('input[type="file"]').first();

    // Upload file
    await fileInput.setInputFiles(filePath);

    // Wait for file loading to start (check for file name in logs)
    await this.page.waitForTimeout(1000);
  }

  async waitForCompletion(timeoutMs: number = 600000) {
    const startTime = Date.now();

    // Wait for completion signals in console logs
    while (Date.now() - startTime < timeoutMs) {
      // Check if we have all key completion signals
      const hasStreamingComplete = this.consoleLogs.some(log =>
        log.includes('[useIfc] Geometry streaming complete')
      );
      const hasDataModelComplete = this.consoleLogs.some(log =>
        log.includes('[useIfc] Data model parsing complete') ||
        log.includes('[ColumnarParser] Parsed')
      );

      if (hasStreamingComplete && hasDataModelComplete) {
        // Give a bit more time for any final logs
        await this.page.waitForTimeout(2000);
        break;
      }

      // Wait a bit before checking again
      await this.page.waitForTimeout(1000);
    }

    // Parse metrics from console logs
    this.parseMetrics();
  }

  private parseMetrics() {
    const logs = this.consoleLogs.join('\n');
    
    // Log threading status for debugging
    const threadingLogs = this.consoleLogs.filter(log => 
      log.includes('[IfcLiteBridge]') || log.includes('crossOriginIsolated')
    );
    if (threadingLogs.length > 0) {
      console.log('[Benchmark] Threading status:', threadingLogs);
    }

    // Model open time
    const modelOpenMatch = logs.match(/\[useIfc\] Model opened at (\d+)ms/);
    if (modelOpenMatch) {
      this.metrics.modelOpenMs = parseInt(modelOpenMatch[1], 10);
    }

    // First batch timing
    const firstBatchMatch = logs.match(/\[useIfc\] Batch #1: (\d+) meshes, wait: (\d+)ms/);
    if (firstBatchMatch) {
      this.metrics.firstBatchMeshes = parseInt(firstBatchMatch[1], 10);
      this.metrics.firstBatchWaitMs = parseInt(firstBatchMatch[2], 10);
      this.metrics.firstBatchNumber = 1;
    }

    // Geometry streaming complete
    const streamingCompleteMatch = logs.match(
      /\[useIfc\] Geometry streaming complete: (\d+) batches, (\d+) meshes/
    );
    if (streamingCompleteMatch) {
      this.metrics.totalBatches = parseInt(streamingCompleteMatch[1], 10);
      this.metrics.totalMeshes = parseInt(streamingCompleteMatch[2], 10);
    }

    // WASM wait time
    const wasmWaitMatch = logs.match(/Total wait \(WASM\): (\d+)ms/);
    if (wasmWaitMatch) {
      this.metrics.wasmWaitMs = parseInt(wasmWaitMatch[1], 10);
    }

    // JS process time
    const jsProcessMatch = logs.match(/Total process \(JS\): (\d+)ms/);
    if (jsProcessMatch) {
      this.metrics.jsProcessMs = parseInt(jsProcessMatch[1], 10);
    }

    // Calculate geometry streaming total time (from first batch to complete)
    if (this.metrics.firstBatchWaitMs !== null && this.metrics.wasmWaitMs !== null) {
      // Approximate: WASM wait time is the main component
      this.metrics.geometryStreamingMs = this.metrics.wasmWaitMs;
    }

    // Entity scan time
    const fastScanMatch = logs.match(/\[IfcParser\] Fast scan: (\d+) entities in (\d+)ms/);
    if (fastScanMatch) {
      this.metrics.entityCount = parseInt(fastScanMatch[1], 10);
      this.metrics.entityScanMs = parseInt(fastScanMatch[2], 10);
    }

    // Data model parse time
    const dataModelMatch = logs.match(/\[ColumnarParser\] Parsed (\d+) entities in (\d+)ms/);
    if (dataModelMatch) {
      this.metrics.dataModelEntityCount = parseInt(dataModelMatch[1], 10);
      this.metrics.dataModelParseMs = parseInt(dataModelMatch[2], 10);
    }

    // File size
    const fileSizeMatch = logs.match(/\[useIfc\] File: .+?, size: ([\d.]+)MB/);
    if (fileSizeMatch) {
      this.metrics.fileSizeMB = parseFloat(fileSizeMatch[1]);
    }
  }

  getMetrics(): ViewerBenchmarkMetrics {
    return {
      modelOpenMs: this.metrics.modelOpenMs ?? null,
      firstBatchWaitMs: this.metrics.firstBatchWaitMs ?? null,
      firstBatchNumber: this.metrics.firstBatchNumber ?? null,
      firstBatchMeshes: this.metrics.firstBatchMeshes ?? null,
      totalBatches: this.metrics.totalBatches ?? null,
      totalMeshes: this.metrics.totalMeshes ?? null,
      geometryStreamingMs: this.metrics.geometryStreamingMs ?? null,
      wasmWaitMs: this.metrics.wasmWaitMs ?? null,
      jsProcessMs: this.metrics.jsProcessMs ?? null,
      entityScanMs: this.metrics.entityScanMs ?? null,
      entityCount: this.metrics.entityCount ?? null,
      dataModelParseMs: this.metrics.dataModelParseMs ?? null,
      dataModelEntityCount: this.metrics.dataModelEntityCount ?? null,
      fileSizeMB: this.metrics.fileSizeMB ?? null,
    };
  }

  getConsoleLogs(): string[] {
    return [...this.consoleLogs];
  }
}
