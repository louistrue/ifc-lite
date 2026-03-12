/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite stats <file.ifc>
 *
 * Auto-calculated model KPIs and health check.
 * Provides a one-command overview of building metrics.
 */

import { createHeadlessContext } from '../loader.js';
import { printJson, hasFlag, fatal } from '../output.js';

export async function statsCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite stats <file.ifc> [--json]');

  const jsonOutput = hasFlag(args, '--json');
  const { bim, store } = await createHeadlessContext(filePath);

  // Basic model info
  const schema = store.schemaVersion;
  const entityCount = store.entityCount;

  // Storeys
  const storeys = bim.storeys();
  const storeyNames = storeys.map((s: any) => s.name).filter(Boolean);

  // Building name
  const buildings = bim.query().byType('IfcBuilding').toArray();
  const buildingName = buildings[0]?.name ?? '(unnamed)';

  // Element counts by type
  const ELEMENT_TYPES = [
    'IfcWall', 'IfcSlab', 'IfcDoor', 'IfcWindow', 'IfcColumn', 'IfcBeam',
    'IfcRoof', 'IfcStair', 'IfcRailing', 'IfcSpace', 'IfcMember', 'IfcPlate',
    'IfcCovering', 'IfcFooting', 'IfcCurtainWall', 'IfcFurnishingElement',
  ];
  const elementCounts: Record<string, number> = {};
  let totalElements = 0;
  for (const t of ELEMENT_TYPES) {
    const count = bim.query().byType(t).count();
    if (count > 0) {
      elementCounts[t] = count;
      totalElements += count;
    }
  }

  // Quantity aggregations
  const walls = bim.query().byType('IfcWall').toArray();
  const slabs = bim.query().byType('IfcSlab').toArray();
  const windows = bim.query().byType('IfcWindow').toArray();

  let totalWallArea = 0;
  for (const w of walls) {
    const qsets = bim.quantities(w.ref);
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.name === 'GrossSideArea' || q.name === 'NetSideArea') {
          totalWallArea += Number(q.value) || 0;
          break; // take first area match per entity
        }
      }
    }
  }

  let totalFloorArea = 0;
  for (const s of slabs) {
    const qsets = bim.quantities(s.ref);
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.name === 'GrossArea' || q.name === 'NetArea') {
          totalFloorArea += Number(q.value) || 0;
          break;
        }
      }
    }
  }

  let totalWindowArea = 0;
  for (const w of windows) {
    const qsets = bim.quantities(w.ref);
    for (const qset of qsets) {
      for (const q of qset.quantities) {
        if (q.name === 'Area') {
          totalWindowArea += Number(q.value) || 0;
          break;
        }
      }
    }
  }

  const windowWallRatio = totalWallArea > 0 ? (totalWindowArea / totalWallArea) * 100 : 0;

  // Materials
  const materialSet = new Set<string>();
  for (const w of walls) {
    const mat = bim.materials(w.ref);
    const name = mat?.materials?.[0] ?? mat?.name;
    if (name) materialSet.add(name);
  }

  // Validation checks
  const allEntities = bim.query().toArray();
  const globalIds = allEntities.map((e: any) => e.globalId).filter(Boolean);
  const globalIdCounts = new Map<string, number>();
  for (const id of globalIds) {
    globalIdCounts.set(id, (globalIdCounts.get(id) ?? 0) + 1);
  }
  const duplicateGlobalIds = [...globalIdCounts.entries()].filter(([, count]) => count > 1).length;
  const unnamedElements = allEntities.filter((e: any) => !e.name || e.name === '').length;

  const stats = {
    building: buildingName,
    schema,
    entityCount,
    storeys: storeyNames,
    storeyCount: storeys.length,
    elements: elementCounts,
    totalElements,
    quantities: {
      totalWallArea: round(totalWallArea),
      totalFloorArea: round(totalFloorArea),
      totalWindowArea: round(totalWindowArea),
      windowWallRatio: round(windowWallRatio),
    },
    materials: [...materialSet],
    validation: {
      duplicateGlobalIds,
      unnamedElements,
    },
  };

  if (jsonOutput) {
    printJson(stats);
    return;
  }

  process.stdout.write(`\n  Building: ${buildingName}\n`);
  process.stdout.write(`  Schema: ${schema} | Storeys: ${storeys.length} | Elements: ${totalElements}\n`);
  if (storeyNames.length > 0) {
    process.stdout.write(`  Storeys: ${storeyNames.join(', ')}\n`);
  }
  process.stdout.write('\n');

  // Element breakdown
  process.stdout.write('  Element breakdown:\n');
  const sortedElements = Object.entries(elementCounts).sort((a, b) => b[1] - a[1]);
  for (const [typeName, count] of sortedElements) {
    process.stdout.write(`    ${typeName}: ${count}\n`);
  }
  process.stdout.write('\n');

  // Quantities
  if (totalWallArea > 0 || totalFloorArea > 0) {
    process.stdout.write('  Quantities:\n');
    if (totalWallArea > 0) process.stdout.write(`    Total wall area: ${round(totalWallArea)} m²\n`);
    if (totalFloorArea > 0) process.stdout.write(`    Total floor area: ${round(totalFloorArea)} m²\n`);
    if (totalWindowArea > 0) process.stdout.write(`    Total window area: ${round(totalWindowArea)} m²\n`);
    if (windowWallRatio > 0) process.stdout.write(`    Window-Wall Ratio: ${round(windowWallRatio)}%\n`);
    process.stdout.write('\n');
  }

  // Materials
  if (materialSet.size > 0) {
    process.stdout.write(`  Materials: ${[...materialSet].join(', ')}\n\n`);
  }

  // Validation
  process.stdout.write('  Validation:\n');
  if (duplicateGlobalIds > 0) {
    process.stdout.write(`    ⚠ ${duplicateGlobalIds} duplicate GlobalIds\n`);
  } else {
    process.stdout.write(`    ✓ All GlobalIds unique\n`);
  }
  if (unnamedElements > 0) {
    process.stdout.write(`    ⚠ ${unnamedElements} unnamed elements\n`);
  } else {
    process.stdout.write(`    ✓ All elements named\n`);
  }
  process.stdout.write('\n');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
