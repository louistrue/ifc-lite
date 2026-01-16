/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Worker-based parser wrapper for parallel data model parsing
 * Spawns a Web Worker to parse IFC data model without blocking main thread
 */

import type { IfcDataStore } from './columnar-parser.js';
import type { ParseOptions } from './index.js';

export interface WorkerParserOptions extends ParseOptions {
  /** Worker URL (default: auto-detect) */
  workerUrl?: string;
}

/**
 * Parser that uses Web Worker for true parallel execution
 */
export class WorkerParser {
  private worker: Worker | null = null;
  private workerUrl: string;

  constructor(options: WorkerParserOptions = {}) {
    // Use provided worker URL or construct from import.meta.url
    if (options.workerUrl) {
      this.workerUrl = options.workerUrl;
    } else {
      // Default: construct URL from current module location
      // Vite will handle the ?worker suffix automatically when importing
      try {
        // Construct worker URL relative to this module
        const workerPath = new URL('./parser.worker.ts', import.meta.url);
        // Vite requires ?worker suffix for proper worker handling
        this.workerUrl = workerPath.href + '?worker';
      } catch {
        // Fallback for environments without import.meta.url
        this.workerUrl = './parser.worker.ts?worker';
      }
    }
  }

  /**
   * Parse IFC file into columnar data store using Web Worker
   * Returns immediately, parsing happens in parallel
   */
  async parseColumnar(
    buffer: ArrayBuffer,
    options: ParseOptions = {}
  ): Promise<IfcDataStore> {
    return new Promise((resolve, reject) => {
      // Generate unique ID for this parse request
      const id = `parse_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create worker
      try {
        this.worker = new Worker(this.workerUrl, { type: 'module' });
      } catch (error) {
        // Fallback: if worker creation fails, reject
        reject(new Error(`Failed to create worker: ${error}`));
        return;
      }

      // Handle worker messages
      this.worker.onmessage = (e: MessageEvent) => {
        const { type, id: msgId, progress, dataStore, error } = e.data;

        if (msgId !== id) {
          return; // Ignore messages for other requests
        }

        switch (type) {
          case 'progress':
            // Forward progress updates
            options.onProgress?.(progress);
            break;

          case 'complete':
            // Clean up worker
            this.worker?.terminate();
            this.worker = null;
            resolve(dataStore);
            break;

          case 'error':
            // Clean up worker
            this.worker?.terminate();
            this.worker = null;
            reject(new Error(error));
            break;
        }
      };

      this.worker.onerror = (error) => {
        // Clean up worker
        this.worker?.terminate();
        this.worker = null;
        reject(new Error(`Worker error: ${error.message}`));
      };

      // Transfer buffer to worker (caller is responsible for cloning if needed)
      // The worker will transfer/detach this buffer, so caller must clone before calling
      this.worker.postMessage({ buffer, id }, [buffer]);
    });
  }

  /**
   * Terminate the worker (cleanup)
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
