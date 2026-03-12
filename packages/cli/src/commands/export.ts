/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite export <file.ifc> --format csv|json|ifc [options]
 *
 * Export IFC data to CSV, JSON, or IFC STEP format.
 * Supports type filtering, column selection, and schema conversion on export.
 */

import { writeFile } from 'node:fs/promises';
import { createHeadlessContext } from '../loader.js';
import { getFlag, hasFlag, fatal, writeOutput } from '../output.js';

/**
 * Parse a --where filter string into psetName, propName, operator, value.
 */
function parseWhereFilter(filter: string): { psetName: string; propName: string; operator: string; value?: string } {
  const dotIdx = filter.indexOf('.');
  if (dotIdx <= 0) {
    fatal(`Invalid --where syntax: "${filter}". Expected: PsetName.PropName[=Value]`);
  }

  const psetName = filter.slice(0, dotIdx);
  const rest = filter.slice(dotIdx + 1);

  for (const op of ['!=', '>=', '<=', '>', '<', '=', '~']) {
    const opIdx = rest.indexOf(op);
    if (opIdx > 0) {
      const propName = rest.slice(0, opIdx);
      const value = rest.slice(opIdx + op.length);
      const mappedOp = op === '~' ? 'contains' : op;
      return { psetName, propName, operator: mappedOp, value };
    }
  }

  return { psetName, propName: rest, operator: 'exists' };
}

export async function exportCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  const format = getFlag(args, '--format') ?? 'csv';
  const outPath = getFlag(args, '--out');
  const type = getFlag(args, '--type');
  const columnsStr = getFlag(args, '--columns');
  const separator = getFlag(args, '--separator') ?? ',';
  const limit = getFlag(args, '--limit');
  const propFilter = getFlag(args, '--where');

  if (!filePath) fatal('Usage: ifc-lite export <file.ifc> --format csv|json|ifc [--type IfcWall] [--columns Name,Type,GlobalId] [--where PsetName.Prop=Value] [--out file]');

  const { bim } = await createHeadlessContext(filePath);

  // Build entity query
  let q = bim.query();
  if (type) {
    q = q.byType(...type.split(','));
  }
  if (propFilter) {
    const parsed = parseWhereFilter(propFilter);
    q = q.where(parsed.psetName, parsed.propName, parsed.operator as any, parsed.value);
  }
  if (limit) {
    q = q.limit(parseInt(limit, 10));
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
