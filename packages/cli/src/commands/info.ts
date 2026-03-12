/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite info <file.ifc>
 *
 * Print a summary of an IFC file: schema, entity counts, spatial structure.
 */

import { loadIfcFile } from '../loader.js';
import { printJson, formatTable, hasFlag, fatal } from '../output.js';
import { EntityNode } from '@ifc-lite/query';
import { IFC_ENTITY_NAMES } from '@ifc-lite/data';

export async function infoCommand(args: string[]): Promise<void> {
  const filePath = args.find(a => !a.startsWith('-'));
  if (!filePath) fatal('Usage: ifc-lite info <file.ifc> [--format json|table]');

  const jsonOutput = hasFlag(args, '--json') || args.includes('--format') && args[args.indexOf('--format') + 1] === 'json';

  const store = await loadIfcFile(filePath);

  // Collect type counts
  const typeCounts: Record<string, number> = {};
  for (const [typeName, ids] of store.entityIndex.byType) {
    if (ids.length > 0) {
      // Convert UPPERCASE STEP type name to PascalCase for display
      const displayName = IFC_ENTITY_NAMES[typeName] ?? typeName;
      typeCounts[displayName] = (typeCounts[displayName] ?? 0) + ids.length;
    }
  }

  // Collect storeys
  const storeyIds = store.entityIndex.byType.get('IFCBUILDINGSTOREY') ?? [];
  const storeys = storeyIds.map(id => {
    const node = new EntityNode(store, id);
    return { name: node.name, expressId: id };
  });

  const summary = {
    file: filePath,
    schema: store.schemaVersion,
    fileSize: store.fileSize,
    fileSizeHuman: formatSize(store.fileSize),
    entityCount: store.entityCount,
    parseTime: `${store.parseTime.toFixed(0)}ms`,
    storeys: storeys.map(s => s.name),
    typeCounts,
  };

  if (jsonOutput) {
    printJson(summary);
    return;
  }

  // Table output
  process.stdout.write(`\n  File:     ${filePath}\n`);
  process.stdout.write(`  Schema:   ${store.schemaVersion}\n`);
  process.stdout.write(`  Size:     ${summary.fileSizeHuman}\n`);
  process.stdout.write(`  Entities: ${store.entityCount.toLocaleString()}\n`);
  process.stdout.write(`  Parsed:   ${summary.parseTime}\n`);

  if (storeys.length > 0) {
    process.stdout.write(`\n  Storeys:\n`);
    for (const s of storeys) {
      process.stdout.write(`    - ${s.name || '(unnamed)'}\n`);
    }
  }

  // Top entity types
  const sorted = Object.entries(typeCounts)
    .filter(([name]) => !name.startsWith('IfcRel') && !name.startsWith('IfcProperty') && !name.startsWith('IfcQuantity'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (sorted.length > 0) {
    process.stdout.write(`\n  Entity types (top ${sorted.length}):\n`);
    process.stdout.write(formatTable(
      ['Type', 'Count'],
      sorted.map(([name, count]) => [name, count.toLocaleString()]),
    ).split('\n').map(l => '    ' + l).join('\n') + '\n');
  }

  process.stdout.write('\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
