/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC file loader — reads and parses IFC files for CLI commands.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { IfcParser, type IfcDataStore } from '@ifc-lite/parser';
import { createBimContext, type BimContext } from '@ifc-lite/sdk';
import { HeadlessBackend } from './headless-backend.js';

/**
 * Parse an IFC file from disk into an IfcDataStore.
 * Suppresses parser console output for clean CLI experience.
 */
export async function loadIfcFile(filePath: string): Promise<IfcDataStore> {
  const buffer = await readFile(filePath);
  const parser = new IfcParser();

  // Suppress parser's internal console.log/warn during parsing
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    // Ensure we pass the exact slice — Node Buffers may be views into
    // a larger pooled ArrayBuffer, so buffer.buffer can include extra bytes.
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const store = await parser.parseColumnar(arrayBuffer);
    store.fileSize = buffer.byteLength;
    return store;
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }
}

/**
 * Create a BimContext backed by a headless backend from an IFC file.
 */
export async function createHeadlessContext(filePath: string): Promise<{ bim: BimContext; store: IfcDataStore }> {
  const store = await loadIfcFile(filePath);
  const backend = new HeadlessBackend(store, basename(filePath));
  const bim = createBimContext({ backend });
  return { bim, store };
}
