/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite diff <file1.ifc> <file2.ifc>
 *
 * Compare two IFC files and report differences at the entity, attribute,
 * property, and quantity levels. Supports visual output via a running viewer.
 *
 * Flags:
 *   --json             Output as JSON
 *   --by-entity        Legacy entity-level comparison (GlobalId presence only)
 *   --properties       Include property set comparison (default: on)
 *   --no-properties    Skip property set comparison
 *   --quantities       Include quantity comparison (default: on)
 *   --no-quantities    Skip quantity comparison
 *   --viewer <port>    Send colored diff to a running ifc-lite view instance
 */

import { loadIfcFile, createStreamingContext } from '../loader.js';
import { hasFlag, fatal, printJson, formatTable, getFlag, validateViewerPort } from '../output.js';
import { EntityNode } from '@ifc-lite/query';
import { IFC_ENTITY_NAMES } from '@ifc-lite/data';
import { computeDiff, DIFF_COLORS } from '@ifc-lite/diff';
import type { DiffResult } from '@ifc-lite/diff';

export async function diffCommand(args: string[]): Promise<void> {
  const positional = args.filter(a => !a.startsWith('-'));
  if (positional.length < 2) fatal('Usage: ifc-lite diff <file1.ifc> <file2.ifc> [--json] [--by-entity] [--viewer <port>]');

  const [file1, file2] = positional;
  const jsonOutput = hasFlag(args, '--json');
  const byEntity = hasFlag(args, '--by-entity');
  const viewerPort = validateViewerPort(getFlag(args, '--viewer'));

  const skipProperties = hasFlag(args, '--no-properties');
  const skipQuantities = hasFlag(args, '--no-quantities');

  process.stderr.write(`Loading files...\n`);
  const store1 = await loadIfcFile(file1);
  const store2 = await loadIfcFile(file2);

  // Legacy mode: simple entity-level comparison
  if (byEntity) {
    printLegacyDiff(file1, file2, store1, store2, jsonOutput);
    return;
  }

  // Full diff with attribute, property, and quantity comparison
  process.stderr.write(`Computing diff...\n`);
  const diffResult = computeDiff(store1, store2, {
    attributes: true,
    properties: !skipProperties,
    quantities: !skipQuantities,
  });

  if (jsonOutput) {
    printJson({
      file1: { path: file1, schema: store1.schemaVersion, entityCount: store1.entityCount },
      file2: { path: file2, schema: store2.schemaVersion, entityCount: store2.entityCount },
      ...diffResult,
    });
    return;
  }

  // Human-readable output
  printDiffSummary(file1, file2, store1, store2, diffResult);

  // Visual diff via viewer
  if (viewerPort) {
    await sendVisualDiff(file2, viewerPort, diffResult);
  }
}

function printDiffSummary(
  file1: string,
  file2: string,
  store1: any,
  store2: any,
  diff: DiffResult,
): void {
  process.stdout.write(`\n  File 1 (old): ${file1} (${store1.schemaVersion}, ${store1.entityCount} entities)\n`);
  process.stdout.write(`  File 2 (new): ${file2} (${store2.schemaVersion}, ${store2.entityCount} entities)\n\n`);

  process.stdout.write(`  Summary:\n`);
  process.stdout.write(`    Added:     ${diff.summary.totalAdded}\n`);
  process.stdout.write(`    Deleted:   ${diff.summary.totalDeleted}\n`);
  process.stdout.write(`    Changed:   ${diff.summary.totalChanged}\n`);
  process.stdout.write(`    Unchanged: ${diff.summary.totalUnchanged}\n\n`);

  if (diff.added.length > 0) {
    process.stdout.write(`  Added elements:\n`);
    const rows = diff.added.slice(0, 20).map(e => [e.type, e.name || '(unnamed)', e.globalId]);
    process.stdout.write(formatTable(['Type', 'Name', 'GlobalId'], rows)
      .split('\n').map(l => '    ' + l).join('\n') + '\n');
    if (diff.added.length > 20) {
      process.stdout.write(`    ... and ${diff.added.length - 20} more\n`);
    }
    process.stdout.write('\n');
  }

  if (diff.deleted.length > 0) {
    process.stdout.write(`  Deleted elements:\n`);
    const rows = diff.deleted.slice(0, 20).map(e => [e.type, e.name || '(unnamed)', e.globalId]);
    process.stdout.write(formatTable(['Type', 'Name', 'GlobalId'], rows)
      .split('\n').map(l => '    ' + l).join('\n') + '\n');
    if (diff.deleted.length > 20) {
      process.stdout.write(`    ... and ${diff.deleted.length - 20} more\n`);
    }
    process.stdout.write('\n');
  }

  if (diff.changed.length > 0) {
    process.stdout.write(`  Changed elements:\n`);
    const rows = diff.changed.slice(0, 20).map(e => {
      const changes: string[] = [];
      if (e.attributeChanges.length > 0) changes.push(`${e.attributeChanges.length} attrs`);
      if (e.propertyChanges.length > 0) changes.push(`${e.propertyChanges.length} props`);
      if (e.quantityChanges.length > 0) changes.push(`${e.quantityChanges.length} qtys`);
      return [e.type, e.name || '(unnamed)', changes.join(', '), e.globalId];
    });
    process.stdout.write(formatTable(['Type', 'Name', 'Changes', 'GlobalId'], rows)
      .split('\n').map(l => '    ' + l).join('\n') + '\n');
    if (diff.changed.length > 20) {
      process.stdout.write(`    ... and ${diff.changed.length - 20} more\n`);
    }
    process.stdout.write('\n');
  }
}

async function sendVisualDiff(
  file2: string,
  viewerPort: number,
  diff: DiffResult,
): Promise<void> {
  process.stderr.write(`Sending visual diff to viewer on port ${viewerPort}...\n`);

  try {
    const { bim } = await createStreamingContext(file2, viewerPort);

    const batches: Array<{ refs: number[]; color: [number, number, number, number] }> = [];

    if (diff.added.length > 0) {
      batches.push({ refs: diff.added.map(e => e.expressId), color: DIFF_COLORS.added });
    }
    if (diff.changed.length > 0) {
      batches.push({ refs: diff.changed.map(e => e.expressId2), color: DIFF_COLORS.changed });
    }

    // Apply color overrides via REST API
    for (const batch of batches) {
      const url = `http://localhost:${viewerPort}/api/colorize`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expressIds: batch.refs, color: batch.color }),
      });
    }

    process.stderr.write(`Visual diff applied: green=added, orange=changed\n`);
    process.stderr.write(`  (Deleted elements not shown — they don't exist in the new model)\n`);
  } catch (err: any) {
    process.stderr.write(`Warning: Could not connect to viewer on port ${viewerPort}: ${err.message}\n`);
  }
}

/**
 * Legacy diff mode — simple GlobalId presence comparison + type counts.
 */
function printLegacyDiff(
  file1: string,
  file2: string,
  store1: any,
  store2: any,
  jsonOutput: boolean,
): void {
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
      const displayName = IFC_ENTITY_NAMES[t] ?? t;
      typeDiffs.push({ type: displayName, count1: c1, count2: c2, delta: c2 - c1 });
    }
  }
  typeDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  // Entity-level comparison by GlobalId
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
  const entityDiff = { added, removed, common };

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

  process.stdout.write(`\n  Entity comparison (by GlobalId):\n`);
  process.stdout.write(`    Common:  ${entityDiff.common}\n`);
  process.stdout.write(`    Added:   ${entityDiff.added.length}\n`);
  process.stdout.write(`    Removed: ${entityDiff.removed.length}\n`);

  process.stdout.write('\n');
}
