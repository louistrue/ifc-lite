/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite mutate <file.ifc> --id N --set PsetName.PropName=Value --out output.ifc
 *
 * Modify properties or attributes of IFC entities and save the result.
 * Supports targeting by expressId, type filter, and --where filter.
 */

import { writeFile } from 'node:fs/promises';
import { createHeadlessContext } from '../loader.js';
import { getFlag, hasFlag, fatal, printJson } from '../output.js';

/**
 * Parse a --where filter string.
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

/**
 * Parse a --set value like "Pset_WallCommon.IsExternal=true" into
 * { psetName, propName, value }.
 */
function parseSetArg(setStr: string): { psetName: string; propName: string; value: string } {
  const dotIdx = setStr.indexOf('.');
  if (dotIdx <= 0) {
    fatal(`Invalid --set syntax: "${setStr}". Expected: PsetName.PropName=Value`);
  }
  const psetName = setStr.slice(0, dotIdx);
  const rest = setStr.slice(dotIdx + 1);
  const eqIdx = rest.indexOf('=');
  if (eqIdx <= 0) {
    fatal(`Invalid --set syntax: "${setStr}". Expected: PsetName.PropName=Value`);
  }
  const propName = rest.slice(0, eqIdx);
  const value = rest.slice(eqIdx + 1);
  return { psetName, propName, value };
}

/**
 * Coerce string value to appropriate type.
 */
function coerceValue(value: string): string | number | boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;
  return value;
}

export async function mutateCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite mutate <file.ifc> --id <N> --set PsetName.PropName=Value --out output.ifc');

  const idStr = getFlag(args, '--id');
  const type = getFlag(args, '--type');
  const setStr = getFlag(args, '--set');
  const outPath = getFlag(args, '--out');
  const propFilter = getFlag(args, '--where');
  const jsonOutput = hasFlag(args, '--json');

  if (!setStr) fatal('--set is required. Example: --set Pset_WallCommon.IsExternal=true');
  if (!outPath) fatal('--out is required. Specify output file path.');

  const { psetName, propName, value } = parseSetArg(setStr);
  const coercedValue = coerceValue(value);

  const { bim } = await createHeadlessContext(filePath);

  // Find target entities
  let targets: any[] = [];

  if (idStr) {
    const expressId = parseInt(idStr, 10);
    const entity = bim.entity({ modelId: 'default', expressId });
    if (!entity) fatal(`Entity #${expressId} not found`);
    targets = [entity];
  } else if (type) {
    let q = bim.query().byType(...type.split(','));
    if (propFilter) {
      const parsed = parseWhereFilter(propFilter);
      q = q.where(parsed.psetName, parsed.propName, parsed.operator as any, parsed.value);
    }
    targets = q.toArray();
  } else {
    fatal('Either --id or --type is required to select target entities.');
  }

  if (targets.length === 0) {
    fatal('No entities matched the given criteria.');
  }

  // Apply mutations
  let mutatedCount = 0;
  for (const entity of targets) {
    bim.mutate.setProperty(entity.ref, psetName, propName, coercedValue);
    mutatedCount++;
  }

  // Export the modified model
  const allEntities = bim.query().toArray();
  const allRefs = allEntities.map((e: any) => e.ref);
  const content = bim.export.ifc(allRefs, {});
  await writeFile(outPath, content, 'utf-8');

  if (jsonOutput) {
    printJson({
      mutated: mutatedCount,
      property: `${psetName}.${propName}`,
      value: coercedValue,
      output: outPath,
    });
  } else {
    process.stderr.write(`Mutated ${mutatedCount} entities: ${psetName}.${propName} = ${value}\n`);
    process.stderr.write(`Written to ${outPath}\n`);
  }
}
