/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite convert <file.ifc> --schema IFC4 --out <output.ifc>
 *
 * Convert an IFC file between schema versions.
 * Supports: IFC2X3, IFC4, IFC4X3, IFC5
 */

import { writeFile } from 'node:fs/promises';
import { loadIfcFile } from '../loader.js';
import { getFlag, hasFlag, fatal, printJson } from '../output.js';
import { exportToStep } from '@ifc-lite/export';

const VALID_SCHEMAS = ['IFC2X3', 'IFC4', 'IFC4X3', 'IFC5'];

export async function convertCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite convert <file.ifc> --schema IFC4 --out output.ifc');

  const targetSchema = getFlag(args, '--schema');
  if (!targetSchema) fatal('--schema is required (IFC2X3, IFC4, IFC4X3, IFC5)');
  if (!VALID_SCHEMAS.includes(targetSchema.toUpperCase())) {
    fatal(`Invalid schema: ${targetSchema}. Supported: ${VALID_SCHEMAS.join(', ')}`);
  }

  const outPath = getFlag(args, '--out');
  if (!outPath) fatal('--out is required for convert command');

  const jsonOutput = hasFlag(args, '--json');

  process.stderr.write(`Loading ${filePath}...\n`);
  const store = await loadIfcFile(filePath);
  const sourceSchema = store.schemaVersion ?? 'IFC4';

  process.stderr.write(`Converting ${sourceSchema} → ${targetSchema.toUpperCase()}...\n`);

  const content = exportToStep(store, {
    schema: targetSchema.toUpperCase() as 'IFC2X3' | 'IFC4' | 'IFC4X3' | 'IFC5',
  });

  await writeFile(outPath, content, 'utf-8');

  if (jsonOutput) {
    printJson({
      file: outPath,
      sourceSchema,
      targetSchema: targetSchema.toUpperCase(),
      fileSize: Buffer.byteLength(content, 'utf-8'),
    });
  } else {
    process.stderr.write(`Converted to ${outPath} (${targetSchema.toUpperCase()})\n`);
  }
}
