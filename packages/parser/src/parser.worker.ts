/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Web Worker for parsing IFC data model in parallel
 * Runs parseColumnar in a separate thread to avoid blocking geometry processing
 */

import { IfcParser } from './index.js';
import type { IfcDataStore } from './columnar-parser.js';

// Worker message handler
self.onmessage = async (e: MessageEvent<{ buffer: ArrayBuffer; id: string }>) => {
  const { buffer, id } = e.data;

  try {
    const parser = new IfcParser();
    
    // Parse with progress updates
    const dataStore = await parser.parseColumnar(buffer, {
      onProgress: (progress) => {
        // Send progress updates back to main thread
        self.postMessage({
          type: 'progress',
          id,
          progress,
        });
      },
    });

    // Send result back to main thread
    // Note: We can't transfer complex objects, so we'll serialize
    // The main thread will reconstruct the data store
    self.postMessage({
      type: 'complete',
      id,
      dataStore,
    });
  } catch (error) {
    // Send error back to main thread
    self.postMessage({
      type: 'error',
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
