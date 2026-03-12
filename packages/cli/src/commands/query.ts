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
 * Standard IFC quantity set definitions — maps entity type to its standard Qto_ sets
 * and the quantities within each set. Used for disambiguation warnings.
 */
const STANDARD_QTO_MAP: Record<string, Record<string, string[]>> = {
  IfcWall: {
    Qto_WallBaseQuantities: ['Length', 'Width', 'Height', 'GrossFootprintArea', 'NetFootprintArea', 'GrossSideArea', 'NetSideArea', 'GrossVolume', 'NetVolume'],
  },
  IfcSlab: {
    Qto_SlabBaseQuantities: ['Width', 'Length', 'Depth', 'Perimeter', 'GrossArea', 'NetArea', 'GrossVolume', 'NetVolume'],
  },
  IfcDoor: {
    Qto_DoorBaseQuantities: ['Width', 'Height', 'Perimeter', 'Area'],
  },
  IfcWindow: {
    Qto_WindowBaseQuantities: ['Width', 'Height', 'Perimeter', 'Area'],
  },
  IfcColumn: {
    Qto_ColumnBaseQuantities: ['Length', 'CrossSectionArea', 'OuterSurfaceArea', 'GrossSurfaceArea', 'NetSurfaceArea', 'GrossVolume', 'NetVolume', 'GrossWeight', 'NetWeight'],
  },
  IfcBeam: {
    Qto_BeamBaseQuantities: ['Length', 'CrossSectionArea', 'OuterSurfaceArea', 'GrossSurfaceArea', 'NetSurfaceArea', 'GrossVolume', 'NetVolume', 'GrossWeight', 'NetWeight'],
  },
  IfcSpace: {
    Qto_SpaceBaseQuantities: ['Height', 'FinishCeilingHeight', 'FinishFloorHeight', 'GrossPerimeter', 'NetPerimeter', 'GrossFloorArea', 'NetFloorArea', 'GrossWallArea', 'NetWallArea', 'GrossCeilingArea', 'NetCeilingArea', 'GrossVolume', 'NetVolume'],
  },
  IfcRoof: {
    Qto_RoofBaseQuantities: ['GrossArea', 'NetArea', 'ProjectedArea'],
  },
  IfcStair: {
    Qto_StairBaseQuantities: ['Length', 'GrossVolume', 'NetVolume'],
  },
  IfcRailing: {
    Qto_RailingBaseQuantities: ['Length'],
  },
  IfcMember: {
    Qto_MemberBaseQuantities: ['Length', 'CrossSectionArea', 'OuterSurfaceArea', 'GrossSurfaceArea', 'NetSurfaceArea', 'GrossVolume', 'NetVolume', 'GrossWeight', 'NetWeight'],
  },
  IfcPlate: {
    Qto_PlateBaseQuantities: ['Width', 'Length', 'Perimeter', 'GrossArea', 'NetArea', 'GrossVolume', 'NetVolume', 'GrossWeight', 'NetWeight'],
  },
  IfcCovering: {
    Qto_CoveringBaseQuantities: ['Width', 'Length', 'GrossArea', 'NetArea'],
  },
  IfcFooting: {
    Qto_FootingBaseQuantities: ['Length', 'Width', 'Height', 'CrossSectionArea', 'OuterSurfaceArea', 'GrossVolume', 'NetVolume', 'GrossWeight', 'NetWeight'],
  },
};

/** Valid built-in grouping keys */
const VALID_GROUP_BY_KEYS = ['type', 'storey', 'material'];

/**
 * B9/F6: Auto-prefix Ifc for --type if user omits it.
 * Returns the corrected type string, or the original if already prefixed.
 */
function normalizeTypeName(typeStr: string): string {
  return typeStr.split(',').map(t => {
    const trimmed = t.trim();
    if (trimmed.startsWith('Ifc') || trimmed.startsWith('IFC') || trimmed.startsWith('ifc')) {
      return trimmed;
    }
    // Auto-prefix with Ifc
    const prefixed = 'Ifc' + trimmed;
    process.stderr.write(`Note: Auto-corrected type "${trimmed}" → "${prefixed}"\n`);
    return prefixed;
  }).join(',');
}

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

/**
 * B3/F1: Apply --where filter to entities, searching both property sets AND quantity sets.
 * Falls back to quantity sets when a property set match is not found.
 */
function applyWhereFilter(entities: any[], parsed: ReturnType<typeof parseWhereFilter>, bim: any): any[] {
  return entities.filter(e => {
    // First try property sets
    const props = bim.properties(e.ref);
    const pset = props.find((p: any) => p.name === parsed.psetName);
    if (pset) {
      const prop = pset.properties.find((p: any) => p.name === parsed.propName);
      if (prop) {
        if (parsed.operator === 'exists') return true;
        return compareValues(prop.value, parsed.operator, parsed.value);
      }
    }

    // B3: Also search quantity sets
    const qsets = bim.quantities(e.ref);
    const qset = qsets.find((q: any) => q.name === parsed.psetName);
    if (qset) {
      const qty = qset.quantities.find((q: any) => q.name === parsed.propName);
      if (qty) {
        if (parsed.operator === 'exists') return true;
        return compareValues(qty.value, parsed.operator, parsed.value);
      }
    }

    return false;
  });
}

function compareValues(actual: any, operator: string, expected: string | undefined): boolean {
  if (expected === undefined) return actual != null;
  const normActual = normalizeBooleanValue(actual);
  const normExpected = normalizeBooleanValue(expected);
  switch (operator) {
    case '=': return String(normActual) === String(normExpected);
    case '!=': return String(normActual) !== String(normExpected);
    case '>': return Number(normActual) > Number(normExpected);
    case '<': return Number(normActual) < Number(normExpected);
    case '>=': return Number(normActual) >= Number(normExpected);
    case '<=': return Number(normActual) <= Number(normExpected);
    case 'contains': return String(normActual).toLowerCase().includes(String(normExpected).toLowerCase());
    default: return false;
  }
}

function normalizeBooleanValue(value: unknown): unknown {
  if (value === true || value === '.T.' || value === 'true' || value === 'TRUE') return 'true';
  if (value === false || value === '.F.' || value === 'false' || value === 'FALSE') return 'false';
  return value;
}

/**
 * Helper: get a quantity value for an entity by name (searching all qsets).
 */
function getQuantityValue(bim: any, ref: any, quantityName: string): number | null {
  const qsets = bim.quantities(ref);
  for (const qset of qsets) {
    for (const q of qset.quantities) {
      if (q.name === quantityName) return Number(q.value) || 0;
    }
  }
  return null;
}

export async function queryCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite query <file.ifc> --type IfcWall [--props] [--limit N]');

  let type = getFlag(args, '--type');
  const limit = getFlag(args, '--limit');
  const offset = getFlag(args, '--offset');
  const propFilter = getFlag(args, '--where');
  const jsonOutput = hasFlag(args, '--json');
  const countOnly = hasFlag(args, '--count');
  const spatial = hasFlag(args, '--spatial');
  const sumQuantity = getFlag(args, '--sum');
  const avgQuantity = getFlag(args, '--avg');
  const minQuantity = getFlag(args, '--min');
  const maxQuantity = getFlag(args, '--max');
  const sortBy = getFlag(args, '--sort');
  const descSort = hasFlag(args, '--desc');
  const storeyFilter = getFlag(args, '--storey');
  const quantityNames = hasFlag(args, '--quantity-names');
  const propertyNames = hasFlag(args, '--property-names');
  const uniqueProp = getFlag(args, '--unique');
  const groupBy = getFlag(args, '--group-by');
  const spatialSummary = hasFlag(args, '--summary');

  // B9/F6: Auto-prefix Ifc for --type
  if (type) {
    type = normalizeTypeName(type);
  }

  const { bim } = await createHeadlessContext(filePath);

  // --quantity-names: list available quantities per entity type
  if (quantityNames) {
    const targetType = type;
    if (!targetType) fatal('--quantity-names requires --type (e.g., --type IfcWall --quantity-names)');

    const entities = bim.query().byType(...targetType.split(',')).limit(50).toArray();
    // Collect all quantity names seen, grouped by qset
    const qsetMap: Record<string, Map<string, { count: number; sampleValues: number[] }>> = {};

    for (const e of entities) {
      const qsets = bim.quantities(e.ref);
      for (const qset of qsets) {
        if (!qsetMap[qset.name]) qsetMap[qset.name] = new Map();
        const qmap = qsetMap[qset.name];
        for (const q of qset.quantities) {
          const existing = qmap.get(q.name);
          const numVal = Number(q.value) || 0;
          if (existing) {
            existing.count++;
            if (existing.sampleValues.length < 3) existing.sampleValues.push(numVal);
          } else {
            qmap.set(q.name, { count: 1, sampleValues: [numVal] });
          }
        }
      }
    }

    if (jsonOutput) {
      const result: Record<string, Record<string, unknown>> = {};
      for (const [qsetName, qmap] of Object.entries(qsetMap)) {
        result[qsetName] = {};
        for (const [qName, info] of qmap) {
          result[qsetName][qName] = {
            foundIn: `${info.count}/${entities.length} entities`,
            sampleValues: info.sampleValues,
            fullReference: `${qsetName}.${qName}`,
          };
        }
      }
      // Add standard reference if available
      const stdRef = STANDARD_QTO_MAP[targetType];
      if (stdRef) {
        printJson({ availableQuantities: result, standardReference: stdRef, note: 'Use --sum <QuantityName> to aggregate. Use full QsetName.QuantityName for unambiguous reference.' });
      } else {
        printJson({ availableQuantities: result, note: 'Use --sum <QuantityName> to aggregate.' });
      }
    } else {
      process.stdout.write(`\nQuantities available for ${targetType} (sampled ${entities.length} entities):\n\n`);
      for (const [qsetName, qmap] of Object.entries(qsetMap)) {
        process.stdout.write(`  ${qsetName}:\n`);
        for (const [qName, info] of qmap) {
          const samples = info.sampleValues.map(v => v.toFixed(2)).join(', ');
          process.stdout.write(`    ${qName}  (${info.count}/${entities.length} entities)  samples: [${samples}]\n`);
        }
        process.stdout.write('\n');
      }
      // Warn about ambiguity
      const allNames = new Map<string, string[]>();
      for (const [qsetName, qmap] of Object.entries(qsetMap)) {
        for (const qName of qmap.keys()) {
          const sets = allNames.get(qName) ?? [];
          sets.push(qsetName);
          allNames.set(qName, sets);
        }
      }
      const areaNames = [...allNames.entries()].filter(([name]) =>
        name.toLowerCase().includes('area') || name.toLowerCase().includes('surface'));
      if (areaNames.length > 1) {
        process.stderr.write(`WARNING: Multiple area quantities found. Choose carefully:\n`);
        for (const [name, sets] of areaNames) {
          process.stderr.write(`  - ${name} (in ${sets.join(', ')})\n`);
        }
        process.stderr.write(`  Use --sum <exact-name> with the correct quantity for your analysis.\n\n`);
      }
    }
    return;
  }

  // --property-names: list available properties per entity type
  if (propertyNames) {
    const targetType = type;
    if (!targetType) fatal('--property-names requires --type (e.g., --type IfcWall --property-names)');

    const entities = bim.query().byType(...targetType.split(',')).limit(50).toArray();
    const psetMap: Record<string, Map<string, { count: number; sampleValues: string[] }>> = {};

    for (const e of entities) {
      const psets = bim.properties(e.ref);
      for (const pset of psets) {
        if (!psetMap[pset.name]) psetMap[pset.name] = new Map();
        const pmap = psetMap[pset.name];
        for (const p of pset.properties) {
          const existing = pmap.get(p.name);
          const strVal = p.value != null ? String(p.value) : '';
          if (existing) {
            existing.count++;
            if (existing.sampleValues.length < 3 && strVal && !existing.sampleValues.includes(strVal)) {
              existing.sampleValues.push(strVal);
            }
          } else {
            pmap.set(p.name, { count: 1, sampleValues: strVal ? [strVal] : [] });
          }
        }
      }
    }

    if (jsonOutput) {
      const result: Record<string, Record<string, unknown>> = {};
      for (const [psetName, pmap] of Object.entries(psetMap)) {
        result[psetName] = {};
        for (const [propName, info] of pmap) {
          result[psetName][propName] = {
            foundIn: `${info.count}/${entities.length} entities`,
            sampleValues: info.sampleValues,
            filterPath: `${psetName}.${propName}`,
          };
        }
      }
      printJson({ availableProperties: result, note: 'Use --where PsetName.PropName=Value to filter.' });
    } else {
      process.stdout.write(`\nProperties available for ${targetType} (sampled ${entities.length} entities):\n\n`);
      for (const [psetName, pmap] of Object.entries(psetMap)) {
        process.stdout.write(`  ${psetName}:\n`);
        for (const [propName, info] of pmap) {
          const samples = info.sampleValues.length > 0 ? `  samples: [${info.sampleValues.map(v => `"${v}"`).join(', ')}]` : '';
          process.stdout.write(`    ${propName}  (${info.count}/${entities.length} entities)${samples}\n`);
        }
        process.stdout.write('\n');
      }
    }
    return;
  }

  // B6/F8: --unique: distinct values for a property path, material, or storey
  if (uniqueProp) {
    const targetType = type;
    if (!targetType) fatal('--unique requires --type (e.g., --type IfcWall --unique material)');

    const entities = bim.query().byType(...targetType.split(',')).toArray();
    const valueCounts = new Map<string, number>();

    if (uniqueProp === 'material') {
      // B6: Support --unique material
      for (const e of entities) {
        const mat = bim.materials(e.ref);
        const val = mat?.materials?.[0] ?? mat?.name ?? '(no material)';
        valueCounts.set(val, (valueCounts.get(val) ?? 0) + 1);
      }
    } else if (uniqueProp === 'storey') {
      for (const e of entities) {
        const storey = bim.storey(e.ref);
        const val = storey?.name ?? '(no storey)';
        valueCounts.set(val, (valueCounts.get(val) ?? 0) + 1);
      }
    } else if (uniqueProp === 'type') {
      for (const e of entities) {
        valueCounts.set(e.type, (valueCounts.get(e.type) ?? 0) + 1);
      }
    } else {
      const dotIdx = uniqueProp.indexOf('.');
      if (dotIdx <= 0) fatal(`Invalid --unique path: "${uniqueProp}". Expected: PsetName.PropName, or one of: material, storey, type`);
      const psetName = uniqueProp.slice(0, dotIdx);
      const propName = uniqueProp.slice(dotIdx + 1);

      for (const e of entities) {
        const psets = bim.properties(e.ref);
        const pset = psets.find((p: any) => p.name === psetName);
        const prop = pset?.properties?.find((p: any) => p.name === propName);
        const val = prop?.value != null ? String(prop.value) : '(no value)';
        valueCounts.set(val, (valueCounts.get(val) ?? 0) + 1);
      }
    }

    if (jsonOutput) {
      const result: Record<string, number> = {};
      for (const [val, count] of valueCounts) result[val] = count;
      printJson({ property: uniqueProp, distinctValues: result, totalEntities: entities.length });
    } else {
      const sorted = [...valueCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [val, count] of sorted) {
        process.stdout.write(`${val} (${count})\n`);
      }
      process.stderr.write(`\n${sorted.length} distinct values across ${entities.length} entities\n`);
    }
    return;
  }

  // Spatial tree mode
  if (spatial) {
    const storeys = bim.storeys();
    const tree: Record<string, unknown[]> = {};

    if (storeys.length > 0) {
      for (const storey of storeys) {
        const contained = bim.contains(storey.ref);
        tree[storey.name || `Storey #${storey.ref.expressId}`] = contained.map((e: any) => ({
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
        tree[building.name || `Building #${building.ref.expressId}`] = contained.map((e: any) => ({
          type: e.type,
          name: e.name,
          globalId: e.globalId,
        }));
      }
      if (buildings.length === 0) {
        process.stderr.write('No storeys or buildings found in spatial structure\n');
      }
    }

    if (spatialSummary) {
      // Summary mode: type counts per storey instead of listing every element
      const summary: Record<string, Record<string, number>> = {};
      for (const [storeyName, elements] of Object.entries(tree)) {
        const counts: Record<string, number> = {};
        for (const elem of elements as any[]) {
          counts[elem.type] = (counts[elem.type] || 0) + 1;
        }
        summary[storeyName] = counts;
      }
      if (jsonOutput) {
        printJson(summary);
      } else {
        for (const [storeyName, counts] of Object.entries(summary)) {
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          process.stdout.write(`\n  ${storeyName} (${total} elements):\n`);
          const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
          for (const [typeName, count] of sorted) {
            process.stdout.write(`    ${typeName}: ${count}\n`);
          }
        }
        process.stdout.write('\n');
      }
      return;
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
    const matchedStorey = storeys.find((s: any) =>
      s.name === storeyFilter ||
      s.name.toLowerCase().includes(storeyFilter.toLowerCase()) ||
      String(s.ref.expressId) === storeyFilter
    );
    if (!matchedStorey) {
      const names = storeys.map((s: any) => s.name).filter(Boolean).join(', ');
      fatal(`Storey "${storeyFilter}" not found. Available: ${names || '(none)'}`);
    }
    const contained = bim.contains(matchedStorey.ref);
    const storeyIds = new Set(contained.map((e: any) => e.ref.expressId));
    // Post-filter: only keep entities that are in this storey
    const baseEntities = q.toArray();
    let storeyEntities = baseEntities.filter((e: any) => storeyIds.has(e.ref.expressId));

    // B3: Apply --where filter to storey-filtered entities (with quantity support)
    if (propFilter) {
      const parsed = parseWhereFilter(propFilter);
      storeyEntities = applyWhereFilter(storeyEntities, parsed, bim);
    }

    const sAggQty = sumQuantity ?? avgQuantity ?? minQuantity ?? maxQuantity;
    const sAggMode: 'sum' | 'avg' | 'min' | 'max' | undefined = sumQuantity ? 'sum' : avgQuantity ? 'avg' : minQuantity ? 'min' : maxQuantity ? 'max' : undefined;
    if (groupBy && sAggQty) {
      outputGroupBy(storeyEntities, groupBy, sAggQty, bim, jsonOutput, limit ? parseInt(limit, 10) : undefined, sAggMode);
      return;
    }
    if (sumQuantity) {
      outputSum(storeyEntities, sumQuantity, bim, jsonOutput);
      return;
    }
    if (avgQuantity) {
      outputAggregation(storeyEntities, avgQuantity, 'avg', bim, jsonOutput);
      return;
    }
    if (minQuantity) {
      outputAggregation(storeyEntities, minQuantity, 'min', bim, jsonOutput);
      return;
    }
    if (maxQuantity) {
      outputAggregation(storeyEntities, maxQuantity, 'max', bim, jsonOutput);
      return;
    }
    if (groupBy) {
      outputGroupBy(storeyEntities, groupBy, undefined, bim, jsonOutput, limit ? parseInt(limit, 10) : undefined);
      return;
    }
    if (countOnly) {
      outputCount(storeyEntities.length, jsonOutput);
      return;
    }
    if (sortBy) {
      storeyEntities = sortEntities(storeyEntities, sortBy, descSort, bim);
    }
    outputEntities(storeyEntities, args, bim, jsonOutput);
    return;
  }

  // --where filter: search both property sets and quantity sets (B3)
  if (propFilter) {
    const parsed = parseWhereFilter(propFilter);
    // We need to do manual filtering to support quantity sets
    let entities = q.toArray();
    entities = applyWhereFilter(entities, parsed, bim);

    const whereAggQty = sumQuantity ?? avgQuantity ?? minQuantity ?? maxQuantity;
    const whereAggMode: 'sum' | 'avg' | 'min' | 'max' | undefined = sumQuantity ? 'sum' : avgQuantity ? 'avg' : minQuantity ? 'min' : maxQuantity ? 'max' : undefined;
    // When grouping, don't slice entities — pass limit as groupLimit instead
    if (groupBy && whereAggQty) {
      outputGroupBy(entities, groupBy, whereAggQty, bim, jsonOutput, limit ? parseInt(limit, 10) : undefined, whereAggMode);
      return;
    }
    if (groupBy) {
      outputGroupBy(entities, groupBy, undefined, bim, jsonOutput, limit ? parseInt(limit, 10) : undefined);
      return;
    }
    // Aggregations operate on the full filtered set (no offset/limit)
    if (sumQuantity) {
      outputSum(entities, sumQuantity, bim, jsonOutput);
      return;
    }
    if (avgQuantity) {
      outputAggregation(entities, avgQuantity, 'avg', bim, jsonOutput);
      return;
    }
    if (minQuantity) {
      outputAggregation(entities, minQuantity, 'min', bim, jsonOutput);
      return;
    }
    if (maxQuantity) {
      outputAggregation(entities, maxQuantity, 'max', bim, jsonOutput);
      return;
    }
    // Apply offset/limit only for non-aggregation, non-group paths
    if (offset) entities = entities.slice(parseInt(offset, 10));
    if (limit) entities = entities.slice(0, parseInt(limit, 10));
    if (countOnly) {
      outputCount(entities.length, jsonOutput);
      return;
    }
    if (sortBy) {
      entities = sortEntities(entities, sortBy, descSort, bim);
    }
    outputEntities(entities, args, bim, jsonOutput);
    return;
  }

  if (limit && !groupBy) q = q.limit(parseInt(limit, 10));
  if (offset) q = q.offset(parseInt(offset, 10));

  // B11: Validate --group-by key
  if (groupBy) {
    if (!VALID_GROUP_BY_KEYS.includes(groupBy) && !groupBy.includes('.')) {
      fatal(`Unknown grouping "${groupBy}". Valid options: ${VALID_GROUP_BY_KEYS.join(', ')}, or PsetName.PropName`);
    }
  }

  // Detect aggregation quantity and mode for --group-by combos
  const aggQuantity = sumQuantity ?? avgQuantity ?? minQuantity ?? maxQuantity;
  const aggMode: 'sum' | 'avg' | 'min' | 'max' | undefined = sumQuantity ? 'sum' : avgQuantity ? 'avg' : minQuantity ? 'min' : maxQuantity ? 'max' : undefined;

  // --group-by + aggregation combo: aggregate per group
  if (groupBy && aggQuantity) {
    const entities = q.toArray();
    // B12: pass limit to outputGroupBy to limit groups, not entities
    outputGroupBy(entities, groupBy, aggQuantity, bim, jsonOutput, limit ? parseInt(limit, 10) : undefined, aggMode);
    return;
  }

  // --sum mode: aggregate a quantity across matched entities
  if (sumQuantity) {
    const entities = q.toArray();
    outputSum(entities, sumQuantity, bim, jsonOutput);
    return;
  }

  // B7/F2: --avg mode
  if (avgQuantity) {
    const entities = q.toArray();
    outputAggregation(entities, avgQuantity, 'avg', bim, jsonOutput);
    return;
  }

  // B7/F2: --min mode
  if (minQuantity) {
    const entities = q.toArray();
    outputAggregation(entities, minQuantity, 'min', bim, jsonOutput);
    return;
  }

  // B7/F2: --max mode
  if (maxQuantity) {
    const entities = q.toArray();
    outputAggregation(entities, maxQuantity, 'max', bim, jsonOutput);
    return;
  }

  // --group-by mode: pivot table grouped by a property or 'type'/'material'
  if (groupBy) {
    const entities = q.toArray();
    // B12: pass limit to outputGroupBy to limit groups, not entities
    outputGroupBy(entities, groupBy, undefined, bim, jsonOutput, limit ? parseInt(limit, 10) : undefined);
    return;
  }

  if (countOnly) {
    const count = q.count();
    outputCount(count, jsonOutput);
    return;
  }

  let entities = q.toArray();

  // F7: --sort by quantity
  if (sortBy) {
    entities = sortEntities(entities, sortBy, descSort, bim);
  }

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
  // Track all quantity names seen (for disambiguation warning)
  const allQuantityNames = new Map<string, { qsetName: string; count: number }>();
  const matchedQsets = new Set<string>();

  for (const e of entities) {
    const qsets = bim.quantities(e.ref);
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        // Track all quantities for disambiguation
        const key = `${qset.name}.${q.name}`;
        const existing = allQuantityNames.get(key);
        if (existing) {
          existing.count++;
        } else {
          allQuantityNames.set(key, { qsetName: qset.name, count: 1 });
        }
        if (q.name === quantityName) {
          total += Number(q.value) || 0;
          matched++;
          matchedQsets.add(qset.name);
        }
      }
    }
  }

  // B10: Better error when quantity not found
  if (matched === 0 && entities.length > 0) {
    const availableNames = new Set<string>();
    for (const [key] of allQuantityNames) {
      availableNames.add(key.split('.').pop()!);
    }
    if (jsonOutput) {
      printJson({
        quantity: quantityName,
        total: 0,
        matchedEntities: 0,
        totalEntities: entities.length,
        error: `Quantity "${quantityName}" not found in any of the ${entities.length} entities.`,
        availableQuantities: [...availableNames],
        hint: 'Use --quantity-names --type <Type> to see all available quantities with details.',
      });
    } else {
      process.stdout.write(`0\n`);
      process.stderr.write(`Quantity "${quantityName}" not found in any of the ${entities.length} entities.\n`);
      if (availableNames.size > 0) {
        process.stderr.write(`Available quantities: ${[...availableNames].join(', ')}\n`);
      }
      process.stderr.write(`Use --quantity-names --type <Type> to see all available quantities.\n`);
    }
    return;
  }

  // Check for ambiguous area/volume quantities and warn
  const similarNames = [...allQuantityNames.entries()]
    .filter(([key]) => {
      const qName = key.split('.').pop()!.toLowerCase();
      const searchName = quantityName.toLowerCase();
      // Warn if there are other quantities with similar base concept (area, volume, etc.)
      if (searchName.includes('area')) return qName.includes('area') || qName.includes('surface');
      if (searchName.includes('volume')) return qName.includes('volume');
      if (searchName.includes('length')) return qName.includes('length');
      return false;
    })
    .filter(([key]) => key.split('.').pop() !== quantityName);

  if (jsonOutput) {
    const result: Record<string, unknown> = {
      quantity: quantityName,
      total,
      matchedEntities: matched,
      totalEntities: entities.length,
      fromQuantitySets: [...matchedQsets],
    };
    if (similarNames.length > 0) {
      result.warning = 'Other similar quantities exist — verify you are using the correct one';
      result.alternatives = similarNames.map(([key, info]) => ({
        name: key,
        foundInEntities: info.count,
      }));
    }
    printJson(result);
  } else {
    process.stdout.write(`${total}\n`);
    process.stderr.write(`${quantityName}: ${total} (from ${matched} of ${entities.length} entities, qsets: ${[...matchedQsets].join(', ')})\n`);
    if (similarNames.length > 0) {
      process.stderr.write(`\nWARNING: Other similar quantities exist in these entities:\n`);
      for (const [key, info] of similarNames) {
        process.stderr.write(`  - ${key} (${info.count} entities)\n`);
      }
      process.stderr.write(`  Verify you are summing the correct quantity for your analysis.\n`);
      process.stderr.write(`  Use --quantity-names --type <Type> to see all available quantities.\n`);
    }
  }
}

/**
 * B7/F2: --avg, --min, --max aggregation functions.
 */
function outputAggregation(entities: any[], quantityName: string, mode: 'avg' | 'min' | 'max', bim: any, jsonOutput: boolean): void {
  let total = 0;
  let matched = 0;
  let minVal = Infinity;
  let maxVal = -Infinity;
  let minEntity: any = null;
  let maxEntity: any = null;

  for (const e of entities) {
    const val = getQuantityValue(bim, e.ref, quantityName);
    if (val !== null) {
      total += val;
      matched++;
      if (val < minVal) { minVal = val; minEntity = e; }
      if (val > maxVal) { maxVal = val; maxEntity = e; }
    }
  }

  // B10: quantity not found
  if (matched === 0) {
    if (jsonOutput) {
      printJson({ quantity: quantityName, error: `Quantity "${quantityName}" not found.`, hint: 'Use --quantity-names --type <Type> to see available quantities.' });
    } else {
      process.stderr.write(`Quantity "${quantityName}" not found in any of the ${entities.length} entities.\n`);
      process.stderr.write(`Use --quantity-names --type <Type> to see all available quantities.\n`);
    }
    return;
  }

  const avg = total / matched;
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);

  if (jsonOutput) {
    const result: Record<string, unknown> = { quantity: quantityName, matchedEntities: matched, totalEntities: entities.length };
    if (mode === 'avg') {
      result.average = avg;
    } else if (mode === 'min') {
      result.min = minVal;
      if (minEntity) result.entity = { Name: minEntity.name, Type: minEntity.type, GlobalId: minEntity.globalId };
    } else {
      result.max = maxVal;
      if (maxEntity) result.entity = { Name: maxEntity.name, Type: maxEntity.type, GlobalId: maxEntity.globalId };
    }
    printJson(result);
  } else {
    if (mode === 'avg') {
      process.stdout.write(`${avg}\n`);
      process.stderr.write(`${label} ${quantityName}: ${avg.toFixed(4)} (${matched} entities)\n`);
    } else if (mode === 'min') {
      process.stdout.write(`${minVal}\n`);
      process.stderr.write(`${label} ${quantityName}: ${minVal} (${minEntity?.name ?? 'unknown'})\n`);
    } else {
      process.stdout.write(`${maxVal}\n`);
      process.stderr.write(`${label} ${quantityName}: ${maxVal} (${maxEntity?.name ?? 'unknown'})\n`);
    }
  }
}

/**
 * F7: Sort entities by quantity, attribute, or property value.
 * Supports: quantity names, entity attributes (name/type/globalId), PsetName.PropName
 */
function sortEntities(entities: any[], sortBy: string, descending: boolean, bim: any): any[] {
  const ATTR_KEYS = ['name', 'type', 'globalId', 'globalid', 'description', 'objectType', 'objecttype'];
  const isAttr = ATTR_KEYS.includes(sortBy) || ATTR_KEYS.includes(sortBy.toLowerCase());
  const isDotted = sortBy.includes('.');

  return entities.slice().sort((a, b) => {
    let valA: any;
    let valB: any;

    if (isAttr) {
      // Sort by entity attribute (alphabetical)
      const key = sortBy.toLowerCase() === 'globalid' ? 'globalId'
        : sortBy.toLowerCase() === 'objecttype' ? 'objectType'
        : sortBy.toLowerCase();
      valA = a[key] ?? '';
      valB = b[key] ?? '';
      const cmp = String(valA).localeCompare(String(valB));
      return descending ? -cmp : cmp;
    } else if (isDotted) {
      // Sort by PsetName.PropName
      const [psetName, propName] = sortBy.split('.', 2);
      const getVal = (e: any) => {
        const props = bim.properties(e.ref);
        const pset = props.find((p: any) => p.name === psetName);
        const prop = pset?.properties?.find((p: any) => p.name === propName);
        if (prop?.value != null) return prop.value;
        // Also check quantity sets
        const qsets = bim.quantities(e.ref);
        const qset = qsets.find((q: any) => q.name === psetName);
        const qty = qset?.quantities?.find((q: any) => q.name === propName);
        return qty?.value ?? null;
      };
      valA = getVal(a);
      valB = getVal(b);
      if (typeof valA === 'number' && typeof valB === 'number') {
        return descending ? valB - valA : valA - valB;
      }
      const cmp = String(valA ?? '').localeCompare(String(valB ?? ''));
      return descending ? -cmp : cmp;
    } else {
      // Sort by quantity name (numeric)
      valA = getQuantityValue(bim, a.ref, sortBy) ?? 0;
      valB = getQuantityValue(bim, b.ref, sortBy) ?? 0;
      return descending ? valB - valA : valA - valB;
    }
  });
}

function outputGroupBy(entities: any[], groupByKey: string, sumQuantity: string | undefined, bim: any, jsonOutput: boolean, groupLimit?: number, aggMode?: 'sum' | 'avg' | 'min' | 'max'): void {
  // B11: Validate group-by key
  if (!VALID_GROUP_BY_KEYS.includes(groupByKey) && !groupByKey.includes('.')) {
    fatal(`Unknown grouping "${groupByKey}". Valid options: ${VALID_GROUP_BY_KEYS.join(', ')}, or PsetName.PropName`);
  }

  const groups = new Map<string, any[]>();

  for (const e of entities) {
    let groupValue: string;

    if (groupByKey === 'type') {
      groupValue = e.type;
    } else if (groupByKey === 'storey') {
      const storey = bim.storey(e.ref);
      groupValue = storey?.name ?? '(no storey)';
    } else if (groupByKey === 'material') {
      const mat = bim.materials(e.ref);
      groupValue = mat?.materials?.[0] ?? mat?.name ?? '(no material)';
    } else if (groupByKey.includes('.')) {
      // PsetName.PropName
      const [psetName, propName] = groupByKey.split('.', 2);
      const props = bim.properties(e.ref);
      const pset = props.find((p: any) => p.name === psetName);
      const prop = pset?.properties?.find((p: any) => p.name === propName);
      groupValue = prop?.value != null ? String(prop.value) : `(no ${propName})`;
    } else {
      groupValue = e[groupByKey] ?? `(no ${groupByKey})`;
    }

    const existing = groups.get(groupValue);
    if (existing) {
      existing.push(e);
    } else {
      groups.set(groupValue, [e]);
    }
  }

  // Compute per-group aggregation if a quantity is specified alongside --group-by
  const mode = aggMode ?? 'sum';
  const groupAgg = new Map<string, number>();
  if (sumQuantity) {
    for (const [key, groupEntities] of groups) {
      let sum = 0;
      let count = 0;
      let minVal = Infinity;
      let maxVal = -Infinity;
      for (const e of groupEntities) {
        const val = getQuantityValue(bim, e.ref, sumQuantity);
        if (val !== null) {
          sum += val;
          count++;
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }
      if (mode === 'avg') groupAgg.set(key, count > 0 ? sum / count : 0);
      else if (mode === 'min') groupAgg.set(key, count > 0 ? minVal : 0);
      else if (mode === 'max') groupAgg.set(key, count > 0 ? maxVal : 0);
      else groupAgg.set(key, sum);
    }
  }

  const modeLabel = mode === 'sum' ? 'sum' : mode;

  if (jsonOutput) {
    const result: Record<string, unknown> = {};
    let entries = [...groups.entries()];
    // B12: --limit limits groups, not entities
    if (groupLimit) entries = entries.slice(0, groupLimit);
    for (const [key, groupEntities] of entries) {
      const entry: Record<string, unknown> = { count: groupEntities.length };
      if (sumQuantity) entry[sumQuantity] = groupAgg.get(key) ?? 0;
      if (sumQuantity && mode !== 'sum') entry.aggregation = mode;
      result[key] = entry;
    }
    printJson(result);
  } else {
    let sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    // B12: --limit limits groups, not entities
    if (groupLimit) sorted = sorted.slice(0, groupLimit);
    process.stdout.write(`\nGrouped by ${groupByKey}${sumQuantity ? ` (${modeLabel}: ${sumQuantity})` : ''}:\n\n`);
    for (const [key, groupEntities] of sorted) {
      if (sumQuantity) {
        const agg = groupAgg.get(key) ?? 0;
        process.stdout.write(`  ${key}:  ${groupEntities.length} elements,  ${sumQuantity} ${modeLabel}: ${mode === 'avg' ? agg.toFixed(4) : agg}\n`);
      } else {
        process.stdout.write(`  ${key}: ${groupEntities.length}\n`);
      }
    }
    if (sumQuantity) {
      const grandTotal = [...groupAgg.values()].reduce((a, b) => a + b, 0);
      process.stdout.write(`\n  Total: ${entities.length} entities in ${groups.size} groups\n\n`);
    } else {
      process.stdout.write(`\n  Total: ${entities.length} entities in ${groups.size} groups\n\n`);
    }
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
