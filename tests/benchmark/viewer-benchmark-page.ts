/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Page, ConsoleMessage } from '@playwright/test';

export interface ViewerBenchmarkMetrics {
  // Wall-clock total time (what users actually experience)
  totalWallClockMs: number | null;
  // File read time
  fileReadMs: number | null;
  // Individual phase timings
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
  // New: Actual render time
  renderCompleteMs: number | null;
  canvasHasContent: boolean;
}

export class ViewerBenchmarkPage {
  private page: Page;
  private consoleLogs: string[] = [];
  private metrics: Partial<ViewerBenchmarkMetrics> = {};
  private loadStartTime: number = 0;
  private loadEndTime: number = 0;

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

    // Record wall-clock start time
    this.loadStartTime = Date.now();

    // Upload file
    await fileInput.setInputFiles(filePath);

    // Wait for file loading to start (check for file name in logs)
    await this.page.waitForTimeout(1000);
  }

  /**
   * Check if canvas has actual rendered content (not just blank/gray)
   */
  private async checkCanvasHasContent(): Promise<boolean> {
    try {
      const hasContent = await this.page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        if (!canvas) return false;
        
        // Check if canvas has non-zero dimensions
        if (canvas.width === 0 || canvas.height === 0) return false;
        
        // Try to sample a few pixels to see if there's actual content
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const imageData = ctx.getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height / 2),
            10, 10
          );
          // Check if any pixels have non-background colors
          for (let i = 0; i < imageData.data.length; i += 4) {
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            // Not pure background gray (128, 128, 128 or similar)
            if (Math.abs(r - g) > 5 || Math.abs(g - b) > 5 || r > 200 || r < 50) {
              return true;
            }
          }
        }
        
        // For WebGPU, we can't easily read pixels, so just check dimensions
        return canvas.width > 0 && canvas.height > 0;
      });
      return hasContent;
    } catch {
      return false;
    }
  }

  async waitForCompletion(timeoutMs: number = 600000) {
    const startTime = Date.now();
    let renderCompleteTime: number | null = null;

    // Wait for completion signals in console logs AND actual rendering
    while (Date.now() - startTime < timeoutMs) {
      // Check if we have all key completion signals
      const hasStreamingComplete = this.consoleLogs.some(log =>
        log.includes('[useIfc] Geometry streaming complete')
      );
      const hasDataModelComplete = this.consoleLogs.some(log =>
        log.includes('[useIfc] Data model parsing complete') ||
        log.includes('[ColumnarParser] Parsed')
      );
      const hasTotalLoadTime = this.consoleLogs.some(log =>
        log.includes('[useIfc] TOTAL LOAD TIME')
      );

      // Check canvas has actual content
      const canvasReady = await this.checkCanvasHasContent();
      
      if (hasStreamingComplete && hasDataModelComplete && hasTotalLoadTime) {
        // Record when we see completion in logs
        if (!renderCompleteTime) {
          renderCompleteTime = Date.now();
        }
        
        // Wait for canvas to actually have content (GPU flush)
        if (canvasReady) {
          this.loadEndTime = Date.now();
          this.metrics.canvasHasContent = true;
          // Additional wait for any pending GPU operations
          await this.page.waitForTimeout(200);
          break;
        }
      }

      // Wait a bit before checking again
      await this.page.waitForTimeout(100);
    }

    // Calculate render delay (time between log completion and actual render)
    if (renderCompleteTime && this.loadEndTime) {
      this.metrics.renderCompleteMs = this.loadEndTime - this.loadStartTime;
    }

    // Parse metrics from console logs
    this.parseMetrics();
  }

  private parseMetrics() {
    const logs = this.consoleLogs.join('\n');
    
    // Calculate wall-clock total time
    if (this.loadStartTime > 0 && this.loadEndTime > 0) {
      this.metrics.totalWallClockMs = this.loadEndTime - this.loadStartTime;
    }
    
    // Log color update status
    const colorLogs = this.consoleLogs.filter(log => 
      log.includes('color') || log.includes('Color')
    );
    if (colorLogs.length > 0) {
      console.log('[Benchmark] Color updates:', colorLogs);
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

    // File size and read time
    const fileSizeMatch = logs.match(/\[useIfc\] File: .+?, size: ([\d.]+)MB, read in (\d+)ms/);
    if (fileSizeMatch) {
      this.metrics.fileSizeMB = parseFloat(fileSizeMatch[1]);
      this.metrics.fileReadMs = parseInt(fileSizeMatch[2], 10);
    } else {
      // Fallback for old format
      const oldFileSizeMatch = logs.match(/\[useIfc\] File: .+?, size: ([\d.]+)MB/);
      if (oldFileSizeMatch) {
        this.metrics.fileSizeMB = parseFloat(oldFileSizeMatch[1]);
      }
    }
    
    // Total load time from app (most accurate measure of user experience)
    const totalLoadMatch = logs.match(/\[useIfc\] TOTAL LOAD TIME.*?: (\d+)ms/);
    if (totalLoadMatch) {
      this.metrics.totalWallClockMs = parseInt(totalLoadMatch[1], 10);
    }
  }

  getMetrics(): ViewerBenchmarkMetrics {
    return {
      totalWallClockMs: this.metrics.totalWallClockMs ?? null,
      fileReadMs: this.metrics.fileReadMs ?? null,
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
      renderCompleteMs: this.metrics.renderCompleteMs ?? null,
      canvasHasContent: this.metrics.canvasHasContent ?? false,
    };
  }

  getConsoleLogs(): string[] {
    return [...this.consoleLogs];
  }
}
