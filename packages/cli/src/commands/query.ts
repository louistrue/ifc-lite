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
  const quantityNames = hasFlag(args, '--quantity-names');
  const groupBy = getFlag(args, '--group-by');
  const spatialSummary = hasFlag(args, '--summary');

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

  // --group-by mode: pivot table grouped by a property or 'type'/'material'
  if (groupBy) {
    const entities = q.toArray();
    outputGroupBy(entities, groupBy, sumQuantity, bim, jsonOutput);
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

function outputGroupBy(entities: any[], groupByKey: string, _sumQuantity: string | undefined, bim: any, jsonOutput: boolean): void {
  const groups = new Map<string, any[]>();

  for (const e of entities) {
    let groupValue: string;

    if (groupByKey === 'type') {
      groupValue = e.type;
    } else if (groupByKey === 'material') {
      const mat = bim.materials(e.ref);
      groupValue = mat?.materials?.[0]?.name ?? mat?.name ?? '(no material)';
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

  if (jsonOutput) {
    const result: Record<string, unknown> = {};
    for (const [key, groupEntities] of groups) {
      result[key] = { count: groupEntities.length };
    }
    printJson(result);
  } else {
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    process.stdout.write(`\nGrouped by ${groupByKey}:\n\n`);
    for (const [key, groupEntities] of sorted) {
      process.stdout.write(`  ${key}: ${groupEntities.length}\n`);
    }
    process.stdout.write(`\n  Total: ${entities.length} entities in ${groups.size} groups\n\n`);
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
