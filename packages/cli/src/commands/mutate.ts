/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite mutate <file.ifc> --id N --set PsetName.PropName=Value --out output.ifc
 *
 * Modify properties or attributes of IFC entities and save the result.
 * Uses MutablePropertyView + StepExporter for real mutation persistence.
 */

import { writeFile } from 'node:fs/promises';
import { loadIfcFile, createHeadlessContext } from '../loader.js';
import { getFlag, hasFlag, fatal, printJson } from '../output.js';
import { MutablePropertyView } from '@ifc-lite/mutations';
import { StepExporter } from '@ifc-lite/export';
import { extractPropertiesOnDemand } from '@ifc-lite/parser';
import { PropertyValueType } from '@ifc-lite/data';

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
 * Coerce string value to appropriate type and determine PropertyValueType.
 */
function coerceValue(value: string): { coerced: string | number | boolean; valueType: PropertyValueType } {
  if (value === 'true') return { coerced: true, valueType: PropertyValueType.Boolean };
  if (value === 'false') return { coerced: false, valueType: PropertyValueType.Boolean };
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') {
    return {
      coerced: num,
      valueType: Number.isInteger(num) ? PropertyValueType.Integer : PropertyValueType.Real,
    };
  }
  return { coerced: value, valueType: PropertyValueType.String };
}

/**
 * Check if a value matches a filter operator and comparison value.
 */
function matchesFilter(actual: any, operator: string, expected?: string): boolean {
  if (operator === 'exists') return actual != null;
  if (actual == null || expected == null) return false;
  const numActual = Number(actual);
  const numExpected = Number(expected);
  const isNumeric = !isNaN(numActual) && !isNaN(numExpected);
  switch (operator) {
    case '=': return isNumeric ? numActual === numExpected : String(actual) === expected;
    case '!=': return isNumeric ? numActual !== numExpected : String(actual) !== expected;
    case '>': return isNumeric ? numActual > numExpected : false;
    case '<': return isNumeric ? numActual < numExpected : false;
    case '>=': return isNumeric ? numActual >= numExpected : false;
    case '<=': return isNumeric ? numActual <= numExpected : false;
    case 'contains': return String(actual).toLowerCase().includes(expected.toLowerCase());
    default: return false;
  }
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
  const { coerced, valueType } = coerceValue(value);

  // Load the store and create a BimContext for querying
  const { bim, store } = await createHeadlessContext(filePath);

  // Find target entities
  let targets: any[] = [];

  if (idStr) {
    const expressId = parseInt(idStr, 10);
    const entity = bim.entity({ modelId: 'default', expressId });
    if (!entity) fatal(`Entity #${expressId} not found`);
    targets = [entity];
  } else if (type) {
    // Auto-prefix Ifc if user omits it (e.g., "Wall" → "IfcWall")
    const normalizedTypes = type.split(',').map(t => {
      const trimmed = t.trim();
      if (trimmed.startsWith('Ifc') || trimmed.startsWith('IFC') || trimmed.startsWith('ifc')) return trimmed;
      const prefixed = 'Ifc' + trimmed;
      process.stderr.write(`Note: Auto-corrected type "${trimmed}" → "${prefixed}"\n`);
      return prefixed;
    });
    let q = bim.query().byType(...normalizedTypes);
    if (propFilter) {
      const parsed = parseWhereFilter(propFilter);
      // Try standard property where first
      const filtered = q.toArray().filter((e: any) => {
        // Check property sets
        const psets = bim.properties(e.ref);
        for (const pset of psets) {
          if (pset.name === parsed.psetName) {
            const prop = pset.properties?.find((p: any) => p.name === parsed.propName);
            if (prop && matchesFilter(prop.value, parsed.operator, parsed.value)) return true;
          }
        }
        // Fallback: check quantity sets (Qto_* aware)
        const qsets = bim.quantities(e.ref);
        for (const qset of qsets) {
          if (qset.name === parsed.psetName) {
            const qty = qset.quantities?.find((q: any) => q.name === parsed.propName);
            if (qty && matchesFilter(qty.value, parsed.operator, parsed.value)) return true;
          }
        }
        return false;
      });
      targets = filtered;
    } else {
      targets = q.toArray();
    }
  } else {
    fatal('Either --id or --type is required to select target entities.');
  }

  if (targets.length === 0) {
    fatal('No entities matched the given criteria.');
  }

  // Create MutablePropertyView with on-demand extraction from the store
  const mutationView = new MutablePropertyView(null, 'default');
  mutationView.setOnDemandExtractor((entityId: number) => {
    return extractPropertiesOnDemand(store, entityId);
  });

  // Apply mutations via the real mutation system
  let mutatedCount = 0;
  for (const entity of targets) {
    mutationView.setProperty(
      entity.ref.expressId,
      psetName,
      propName,
      coerced,
      valueType,
    );
    mutatedCount++;
  }

  // Export with mutations applied via StepExporter
  const schema = store.schemaVersion ?? 'IFC4';
  const exporter = new StepExporter(store, mutationView);
  const result = exporter.export({
    schema: schema as any,
    applyMutations: true,
  });

  await writeFile(outPath, result.content, 'utf-8');

  if (jsonOutput) {
    printJson({
      mutated: mutatedCount,
      property: `${psetName}.${propName}`,
      value: coerced,
      output: outPath,
      stats: result.stats,
    });
  } else {
    process.stderr.write(`Mutated ${mutatedCount} entities: ${psetName}.${propName} = ${value}\n`);
    process.stderr.write(`Written to ${outPath} (${result.stats.entityCount} entities, ${result.stats.newEntityCount} new)\n`);
  }
}
