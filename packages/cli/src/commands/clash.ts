/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite clash <file1.ifc> [file2.ifc] [options]
 *
 * Detect clashes (collisions, clearance violations, intersections) between
 * IFC elements. Supports single-file self-clash and cross-file clash detection.
 *
 * Flags:
 *   --json                  Output as JSON
 *   --mode <mode>           Detection mode: collision | clearance | intersection (default: collision)
 *   --tolerance <n>         Ignore intersections smaller than n meters (default: 0.002)
 *   --clearance <n>         Clearance distance threshold in meters (default: 0.05)
 *   --allow-touching        Don't report touching surfaces as clashes
 *   --type-a <type>         Filter group A by IFC type (repeatable)
 *   --type-b <type>         Filter group B by IFC type (repeatable)
 *   --config <file.json>    Load clash sets from JSON config file
 *   --viewer <port>         Send colored results to a running ifc-lite view instance
 */

import { readFile } from 'node:fs/promises';
import { loadIfcFile } from '../loader.js';
import { hasFlag, fatal, printJson, formatTable, getFlag, getAllFlags, validateViewerPort } from '../output.js';
import { detectClashes, CLASH_COLORS } from '@ifc-lite/clash';
import type { ClashSet, ClashMode, ClashSettings, ClashResult } from '@ifc-lite/clash';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MeshData } from '@ifc-lite/geometry';
import { GeometryProcessor } from '@ifc-lite/geometry';

export async function clashCommand(args: string[]): Promise<void> {
  // Extract positional args, skipping flag values (e.g. --mode clearance, --viewer 3000)
  const flagsWithValue = new Set([
    '--mode', '--tolerance', '--clearance', '--type-a', '--type-b',
    '--config', '--viewer',
  ]);
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('-')) {
      if (flagsWithValue.has(args[i]) && i + 1 < args.length) {
        i++; // skip the flag's value
      }
      continue;
    }
    positional.push(args[i]);
  }
  if (positional.length < 1) {
    fatal('Usage: ifc-lite clash <file1.ifc> [file2.ifc] [--mode collision|clearance|intersection] [--json]');
  }

  const jsonOutput = hasFlag(args, '--json');
  const viewerPort = validateViewerPort(getFlag(args, '--viewer'));
  const configFile = getFlag(args, '--config');

  // Parse settings
  const modeStr = getFlag(args, '--mode') ?? 'collision';
  if (!['collision', 'clearance', 'intersection'].includes(modeStr)) {
    fatal(`Invalid mode: ${modeStr}. Must be collision, clearance, or intersection`);
  }

  const toleranceStr = getFlag(args, '--tolerance');
  const clearanceStr = getFlag(args, '--clearance');

  const parseNumericFlag = (value: string, flag: string): number => {
    const n = parseFloat(value);
    if (isNaN(n)) fatal(`Invalid ${flag} value: "${value}" (must be a number)`);
    return n;
  };

  const settings: ClashSettings = {
    mode: modeStr as ClashMode,
    tolerance: toleranceStr ? parseNumericFlag(toleranceStr, '--tolerance') : undefined,
    clearance: clearanceStr ? parseNumericFlag(clearanceStr, '--clearance') : undefined,
    allowTouching: hasFlag(args, '--allow-touching'),
    checkAll: !hasFlag(args, '--first-only'),
  };

  const typesA = getAllFlags(args, '--type-a');
  const typesB = getAllFlags(args, '--type-b');

  // Load IFC files and generate geometry
  process.stderr.write(`Loading files and generating geometry...\n`);
  const stores = new Map<string, { store: IfcDataStore; meshes: MeshData[] }>();

  const processor = new GeometryProcessor();
  await processor.init();

  for (const filePath of positional) {
    const store = await loadIfcFile(filePath);
    process.stderr.write(`  Processing geometry for ${filePath}...\n`);

    const buffer = await readFile(filePath);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    const result = await processor.process(new Uint8Array(arrayBuffer));
    stores.set(filePath, { store, meshes: result.meshes });
  }

  // Build clash sets
  let clashSets: ClashSet[];

  if (configFile) {
    try {
      const configData = await readFile(configFile, 'utf-8');
      const parsed = JSON.parse(configData);
      if (!Array.isArray(parsed)) fatal(`Config file ${configFile} must contain a JSON array of clash sets`);
      clashSets = parsed as ClashSet[];
    } catch (err: any) {
      fatal(`Failed to load config file ${configFile}: ${err.message}`);
    }
  } else if (positional.length === 1) {
    clashSets = [{
      name: 'Self-clash',
      a: { file: positional[0], types: typesA.length > 0 ? typesA : undefined },
    }];
  } else {
    clashSets = [{
      name: `${positional[0]} vs ${positional[1]}`,
      a: { file: positional[0], types: typesA.length > 0 ? typesA : undefined },
      b: { file: positional[1], types: typesB.length > 0 ? typesB : undefined },
    }];
  }

  // Run clash detection
  process.stderr.write(`Running clash detection (${settings.mode} mode)...\n`);
  const result = detectClashes(clashSets, stores, settings);

  if (jsonOutput) {
    printJson(result);
    return;
  }

  // Human-readable output
  printClashSummary(result);

  // Visual output via viewer
  if (viewerPort) {
    await sendVisualClashes(viewerPort, result);
  }
}

function printClashSummary(result: ClashResult): void {
  process.stdout.write(`\n  Clash Detection Results\n`);
  process.stdout.write(`  Mode: ${result.settings.mode}`);
  if (result.settings.mode === 'clearance') {
    process.stdout.write(` (threshold: ${result.settings.clearance}m)`);
  }
  process.stdout.write(`\n  Tolerance: ${result.settings.tolerance}m\n\n`);

  process.stdout.write(`  Total clashes: ${result.summary.totalClashes}\n\n`);

  if (result.summary.totalClashes === 0) {
    process.stdout.write(`  No clashes detected.\n\n`);
    return;
  }

  // By clash set
  const setEntries = Object.entries(result.summary.byClashSet);
  if (setEntries.length > 0) {
    process.stdout.write(`  By clash set:\n`);
    for (const [name, count] of setEntries) {
      process.stdout.write(`    ${name}: ${count}\n`);
    }
    process.stdout.write('\n');
  }

  // By type pair
  const typeEntries = Object.entries(result.summary.byTypePair)
    .sort(([, a], [, b]) => b - a);
  if (typeEntries.length > 0) {
    process.stdout.write(`  By type pair:\n`);
    const rows = typeEntries.map(([pair, count]) => [pair, String(count)]);
    process.stdout.write(formatTable(['Type Pair', 'Count'], rows)
      .split('\n').map(l => '    ' + l).join('\n') + '\n\n');
  }

  // Individual clashes (first 30)
  process.stdout.write(`  Clashes:\n`);
  const clashRows = result.clashes.slice(0, 30).map((c, i) => [
    String(i + 1),
    `${c.a.type} (${c.a.name || c.a.globalId.slice(0, 8)})`,
    `${c.b.type} (${c.b.name || c.b.globalId.slice(0, 8)})`,
    c.distance < 0 ? `${c.distance.toFixed(4)}m (penetration)` : `${c.distance.toFixed(4)}m`,
  ]);
  process.stdout.write(formatTable(['#', 'Element A', 'Element B', 'Distance'], clashRows)
    .split('\n').map(l => '    ' + l).join('\n') + '\n');

  if (result.clashes.length > 30) {
    process.stdout.write(`    ... and ${result.clashes.length - 30} more\n`);
  }

  process.stdout.write('\n');
}

async function sendVisualClashes(viewerPort: number, result: ClashResult): Promise<void> {
  if (result.clashes.length === 0) return;

  process.stderr.write(`Sending clash visualization to viewer on port ${viewerPort}...\n`);

  try {
    const clashIdsA = new Set<number>();
    const clashIdsB = new Set<number>();

    for (const clash of result.clashes) {
      clashIdsA.add(clash.a.expressId);
      clashIdsB.add(clash.b.expressId);
    }

    const batches = [
      { expressIds: [...clashIdsA], color: CLASH_COLORS.clashA },
      { expressIds: [...clashIdsB], color: CLASH_COLORS.clashB },
    ];

    for (const batch of batches) {
      const url = `http://localhost:${viewerPort}/api/command`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'colorizeEntities', ids: batch.expressIds, color: batch.color }),
      });
      if (!res.ok) {
        process.stderr.write(`Warning: Colorize request failed with status ${res.status}\n`);
      }
    }

    process.stderr.write(`Clash visualization applied: red=source, orange=target\n`);
  } catch (err: any) {
    process.stderr.write(`Warning: Could not connect to viewer on port ${viewerPort}: ${err.message}\n`);
  }
}
