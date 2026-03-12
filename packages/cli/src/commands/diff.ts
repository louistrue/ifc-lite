/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite diff <file1.ifc> <file2.ifc>
 *
 * Compare two IFC files and report differences in entity counts,
 * types, and optionally property values.
 */

import { loadIfcFile } from '../loader.js';
import { hasFlag, fatal, printJson, formatTable } from '../output.js';
import { EntityNode } from '@ifc-lite/query';

export async function diffCommand(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'));
  if (positional.length < 2) fatal('Usage: ifc-lite diff <file1.ifc> <file2.ifc> [--json] [--by-type] [--by-entity]');

  const [file1, file2] = positional;
  const jsonOutput = hasFlag(args, '--json');
  const byEntity = hasFlag(args, '--by-entity');

  process.stderr.write(`Loading files...\n`);
  const store1 = await loadIfcFile(file1);
  const store2 = await loadIfcFile(file2);

  // Type-level comparison
  const types1 = new Map<string, number>();
  const types2 = new Map<string, number>();
  for (const [typeName, ids] of store1.entityIndex.byType) {
    types1.set(typeName, ids.length);
  }
  for (const [typeName, ids] of store2.entityIndex.byType) {
    types2.set(typeName, ids.length);
  }

  const allTypes = new Set([...types1.keys(), ...types2.keys()]);
  const typeDiffs: { type: string; count1: number; count2: number; delta: number }[] = [];
  for (const t of allTypes) {
    const c1 = types1.get(t) ?? 0;
    const c2 = types2.get(t) ?? 0;
    if (c1 !== c2) {
      const displayName = store1.entities.getTypeName(
        store1.entityIndex.byType.get(t)?.[0] ?? 0
      ) || store2.entities.getTypeName(
        store2.entityIndex.byType.get(t)?.[0] ?? 0
      ) || t;
      typeDiffs.push({ type: displayName, count1: c1, count2: c2, delta: c2 - c1 });
    }
  }
  typeDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Entity-level comparison by GlobalId
  let entityDiff: { added: string[]; removed: string[]; common: number } | undefined;
  if (byEntity) {
    const globalIds1 = new Set<string>();
    const globalIds2 = new Set<string>();
    for (const [, ids] of store1.entityIndex.byType) {
      for (const id of ids) {
        const node = new EntityNode(store1, id);
        const gid = node.globalId;
        if (gid) globalIds1.add(gid);
      }
    }
    for (const [, ids] of store2.entityIndex.byType) {
      for (const id of ids) {
        const node = new EntityNode(store2, id);
        const gid = node.globalId;
        if (gid) globalIds2.add(gid);
      }
    }

    const added = [...globalIds2].filter(g => !globalIds1.has(g));
    const removed = [...globalIds1].filter(g => !globalIds2.has(g));
    const common = [...globalIds1].filter(g => globalIds2.has(g)).length;
    entityDiff = { added, removed, common };
  }

  const result = {
    file1: { path: file1, schema: store1.schemaVersion, entityCount: store1.entityCount },
    file2: { path: file2, schema: store2.schemaVersion, entityCount: store2.entityCount },
    entityCountDelta: store2.entityCount - store1.entityCount,
    typeDifferences: typeDiffs,
    entityDiff,
  };

  if (jsonOutput) {
    printJson(result);
    return;
  }

  // Human-readable output
  process.stdout.write(`\n  File 1: ${file1} (${store1.schemaVersion}, ${store1.entityCount} entities)\n`);
  process.stdout.write(`  File 2: ${file2} (${store2.schemaVersion}, ${store2.entityCount} entities)\n`);
  process.stdout.write(`  Delta:  ${result.entityCountDelta >= 0 ? '+' : ''}${result.entityCountDelta} entities\n\n`);

  if (typeDiffs.length > 0) {
    process.stdout.write(`  Type differences:\n`);
    const rows = typeDiffs.map(d => [
      d.type,
      String(d.count1),
      String(d.count2),
      (d.delta >= 0 ? '+' : '') + d.delta,
    ]);
    process.stdout.write(formatTable(['Type', 'File 1', 'File 2', 'Delta'], rows)
      .split('\n').map(l => '    ' + l).join('\n') + '\n');
  } else {
    process.stdout.write(`  No type differences.\n`);
  }

  if (entityDiff) {
    process.stdout.write(`\n  Entity comparison (by GlobalId):\n`);
    process.stdout.write(`    Common:  ${entityDiff.common}\n`);
    process.stdout.write(`    Added:   ${entityDiff.added.length}\n`);
    process.stdout.write(`    Removed: ${entityDiff.removed.length}\n`);
  }

  process.stdout.write('\n');
}
