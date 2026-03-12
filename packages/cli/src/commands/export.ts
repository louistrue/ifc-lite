/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite export <file.ifc> --format csv|json [options]
 *
 * Export IFC data to CSV or JSON.
 */

import { writeFile } from 'node:fs/promises';
import { createHeadlessContext } from '../loader.js';
import { getFlag, hasFlag, fatal, writeOutput } from '../output.js';

export async function exportCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  const format = getFlag(args, '--format') ?? 'csv';
  const outPath = getFlag(args, '--out');
  const type = getFlag(args, '--type');
  const columnsStr = getFlag(args, '--columns');
  const separator = getFlag(args, '--separator') ?? ',';

  if (!filePath) fatal('Usage: ifc-lite export <file.ifc> --format csv|json [--type IfcWall] [--columns Name,Type,GlobalId] [--out file]');

  const { bim } = await createHeadlessContext(filePath);

  // Build entity query
  let q = bim.query();
  if (type) {
    q = q.byType(...type.split(','));
  }
  const entities = q.toArray();
  const refs = entities.map(e => e.ref);

  const columns = columnsStr
    ? columnsStr.split(',')
    : ['Type', 'Name', 'GlobalId', 'Description', 'ObjectType'];

  switch (format) {
    case 'csv': {
      const csv = bim.export.csv(refs, { columns, separator });
      await writeOutput(csv, outPath);
      break;
    }
    case 'json': {
      const json = bim.export.json(refs, columns);
      const content = JSON.stringify(json, null, 2);
      await writeOutput(content, outPath);
      break;
    }
    case 'ifc': {
      const schema = getFlag(args, '--schema') as 'IFC2X3' | 'IFC4' | 'IFC4X3' | undefined;
      const content = bim.export.ifc(refs, { schema });
      if (!outPath) fatal('--out is required for IFC export');
      await writeFile(outPath, content, 'utf-8');
      process.stderr.write(`Written to ${outPath}\n`);
      break;
    }
    default:
      fatal(`Unknown format: ${format}. Supported: csv, json, ifc`);
  }
}
