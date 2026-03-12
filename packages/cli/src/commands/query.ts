/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite query <file.ifc> [options]
 *
 * Query entities from an IFC file with type and property filters.
 * Supports all entity data: properties, quantities, materials,
 * classifications, attributes, relationships, type properties.
 */

import { createHeadlessContext } from '../loader.js';
import { printJson, formatTable, getFlag, hasFlag, fatal } from '../output.js';

/**
 * Parse a --where filter string into psetName, propName, operator, value.
 * Supported formats:
 *   PsetName.PropName=Value     (equals)
 *   PsetName.PropName!=Value    (not equals)
 *   PsetName.PropName>Value     (greater than)
 *   PsetName.PropName<Value     (less than)
 *   PsetName.PropName>=Value    (greater or equal)
 *   PsetName.PropName<=Value    (less or equal)
 *   PsetName.PropName~Value     (contains)
 *   PsetName.PropName           (exists)
 */
function parseWhereFilter(filter: string): { psetName: string; propName: string; operator: string; value?: string } {
  const dotIdx = filter.indexOf('.');
  if (dotIdx <= 0) {
    fatal(`Invalid --where syntax: "${filter}". Expected: PsetName.PropName[=Value]`);
  }

  const psetName = filter.slice(0, dotIdx);
  const rest = filter.slice(dotIdx + 1);

  // Try multi-char operators first, then single-char
  for (const op of ['!=', '>=', '<=', '>', '<', '=', '~']) {
    const opIdx = rest.indexOf(op);
    if (opIdx > 0) {
      const propName = rest.slice(0, opIdx);
      const value = rest.slice(opIdx + op.length);
      const mappedOp = op === '~' ? 'contains' : op;
      return { psetName, propName, operator: mappedOp, value };
    }
  }

  // No operator found — exists check
  return { psetName, propName: rest, operator: 'exists' };
}

export async function queryCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite query <file.ifc> --type IfcWall [--props] [--limit N]');

  const type = getFlag(args, '--type');
  const limit = getFlag(args, '--limit');
  const offset = getFlag(args, '--offset');
  const propFilter = getFlag(args, '--where');
  const showProps = hasFlag(args, '--props');
  const showQuantities = hasFlag(args, '--quantities');
  const showMaterials = hasFlag(args, '--materials');
  const showClassifications = hasFlag(args, '--classifications');
  const showAttributes = hasFlag(args, '--attributes');
  const showRelationships = hasFlag(args, '--relationships');
  const showTypeProps = hasFlag(args, '--type-props');
  const showDocuments = hasFlag(args, '--documents');
  const showAll = hasFlag(args, '--all');
  const jsonOutput = hasFlag(args, '--json');
  const countOnly = hasFlag(args, '--count');
  const spatial = hasFlag(args, '--spatial');
  const sumQuantity = getFlag(args, '--sum');
  const storeyFilter = getFlag(args, '--storey');

  const { bim } = await createHeadlessContext(filePath);

  // Spatial tree mode
  if (spatial) {
    const storeys = bim.storeys();
    const tree: Record<string, unknown[]> = {};

    if (storeys.length > 0) {
      for (const storey of storeys) {
        const contained = bim.contains(storey.ref);
        tree[storey.name || `Storey #${storey.ref.expressId}`] = contained.map(e => ({
          type: e.type,
          name: e.name,
          globalId: e.globalId,
        }));
      }
    } else {
      // Fall back to buildings when no storeys exist
      const buildings = bim.query().byType('IfcBuilding').toArray();
      for (const building of buildings) {
        const contained = bim.contains(building.ref);
        tree[building.name || `Building #${building.ref.expressId}`] = contained.map(e => ({
          type: e.type,
          name: e.name,
          globalId: e.globalId,
        }));
      }
      if (buildings.length === 0) {
        process.stderr.write('No storeys or buildings found in spatial structure\n');
      }
    }

    printJson(tree);
    return;
  }

  // Build query
  let q = bim.query();
  if (type) {
    const types = type.split(',');
    q = q.byType(...types);
  }

  // --storey filter: restrict to entities in a specific storey
  if (storeyFilter) {
    const storeys = bim.storeys();
    const matchedStorey = storeys.find(s =>
      s.name === storeyFilter ||
      s.name.toLowerCase().includes(storeyFilter.toLowerCase()) ||
      String(s.ref.expressId) === storeyFilter
    );
    if (!matchedStorey) {
      const names = storeys.map(s => s.name).filter(Boolean).join(', ');
      fatal(`Storey "${storeyFilter}" not found. Available: ${names || '(none)'}`);
    }
    const contained = bim.contains(matchedStorey.ref);
    const storeyIds = new Set(contained.map(e => e.ref.expressId));
    // Post-filter: only keep entities that are in this storey
    const baseEntities = q.toArray();
    const storeyEntities = baseEntities.filter(e => storeyIds.has(e.ref.expressId));

    // Apply --where filter to storey-filtered entities
    if (propFilter) {
      const parsed = parseWhereFilter(propFilter);
      // Re-apply via manual filtering since we've already resolved entities
      const finalEntities = storeyEntities.filter(e => {
        const props = bim.properties(e.ref);
        const pset = props.find(p => p.name === parsed.psetName);
        if (!pset) return false;
        const prop = pset.properties.find((p: any) => p.name === parsed.propName);
        if (!prop) return false;
        if (parsed.operator === 'exists') return true;
        return String(prop.value) === String(parsed.value);
      });

      if (sumQuantity) {
        outputSum(finalEntities, sumQuantity, bim, jsonOutput);
        return;
      }
      if (countOnly) {
        outputCount(finalEntities.length, jsonOutput);
        return;
      }
      outputEntities(finalEntities, args, bim, jsonOutput);
      return;
    }

    if (sumQuantity) {
      outputSum(storeyEntities, sumQuantity, bim, jsonOutput);
      return;
    }
    if (countOnly) {
      outputCount(storeyEntities.length, jsonOutput);
      return;
    }
    outputEntities(storeyEntities, args, bim, jsonOutput);
    return;
  }

  // --where filter with proper syntax validation
  if (propFilter) {
    const parsed = parseWhereFilter(propFilter);
    q = q.where(parsed.psetName, parsed.propName, parsed.operator as any, parsed.value);
  }

  if (limit) q = q.limit(parseInt(limit, 10));
  if (offset) q = q.offset(parseInt(offset, 10));

  // --sum mode: aggregate a quantity across matched entities
  if (sumQuantity) {
    const entities = q.toArray();
    outputSum(entities, sumQuantity, bim, jsonOutput);
    return;
  }

  if (countOnly) {
    const count = q.count();
    outputCount(count, jsonOutput);
    return;
  }

  const entities = q.toArray();
  outputEntities(entities, args, bim, jsonOutput);
}

function outputCount(count: number, jsonOutput: boolean): void {
  if (jsonOutput) {
    printJson({ count });
  } else {
    process.stdout.write(`${count}\n`);
  }
}

function outputSum(entities: any[], quantityName: string, bim: any, jsonOutput: boolean): void {
  let total = 0;
  let matched = 0;
  for (const e of entities) {
    const qsets = bim.quantities(e.ref);
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.name === quantityName) {
          total += Number(q.value) || 0;
          matched++;
        }
      }
    }
  }
  if (jsonOutput) {
    printJson({ quantity: quantityName, total, matchedEntities: matched, totalEntities: entities.length });
  } else {
    process.stdout.write(`${total}\n`);
    process.stderr.write(`${quantityName}: ${total} (from ${matched} of ${entities.length} entities)\n`);
  }
}

function outputEntities(entities: any[], args: string[], bim: any, jsonOutput: boolean): void {
  const showProps = hasFlag(args, '--props');
  const showQuantities = hasFlag(args, '--quantities');
  const showMaterials = hasFlag(args, '--materials');
  const showClassifications = hasFlag(args, '--classifications');
  const showAttributes = hasFlag(args, '--attributes');
  const showRelationships = hasFlag(args, '--relationships');
  const showTypeProps = hasFlag(args, '--type-props');
  const showDocuments = hasFlag(args, '--documents');
  const showAll = hasFlag(args, '--all');

  const needsDetail = showProps || showQuantities || showMaterials || showClassifications
    || showAttributes || showRelationships || showTypeProps || showDocuments || showAll;

  if (jsonOutput || needsDetail) {
    const result = entities.map((e: any) => {
      const entry: Record<string, unknown> = {
        type: e.type,
        name: e.name,
        globalId: e.globalId,
        description: e.description || undefined,
        objectType: e.objectType || undefined,
      };
      if (showAttributes || showAll) entry.attributes = bim.attributes(e.ref);
      if (showProps || showAll) entry.properties = bim.properties(e.ref);
      if (showQuantities || showAll) entry.quantities = bim.quantities(e.ref);
      if (showMaterials || showAll) entry.materials = bim.materials(e.ref);
      if (showClassifications || showAll) entry.classifications = bim.classifications(e.ref);
      if (showTypeProps || showAll) entry.typeProperties = bim.typeProperties(e.ref);
      if (showDocuments || showAll) entry.documents = bim.documents(e.ref);
      if (showRelationships || showAll) entry.relationships = bim.relationships(e.ref);
      return entry;
    });
    printJson(result);
    return;
  }

  // Table output
  const rows = entities.map((e: any) => [e.type, e.name, e.globalId]);
  process.stdout.write(formatTable(['Type', 'Name', 'GlobalId'], rows) + '\n');
  process.stderr.write(`\n${entities.length} entities\n`);
}
