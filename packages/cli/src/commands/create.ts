/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite create <element-type> [options] --out <file.ifc>
 *
 * Create IFC files programmatically from CLI arguments.
 */

import { writeFile } from 'node:fs/promises';
import { IfcCreator } from '@ifc-lite/create';
import { getFlag, hasFlag, fatal, printJson } from '../output.js';

export async function createCommand(args: string[]): Promise<void> {
  const elementType = args.find(a => !a.startsWith('-'));
  if (!elementType) fatal('Usage: ifc-lite create <wall|slab|column|beam> [options] --out <file.ifc>');

  const outPath = getFlag(args, '--out');
  if (!outPath) fatal('--out is required for create command');

  const name = getFlag(args, '--name') ?? elementType;
  const projectName = getFlag(args, '--project') ?? 'CLI Project';
  const storeyName = getFlag(args, '--storey') ?? 'Ground Floor';
  const jsonInput = hasFlag(args, '--from-json');

  const creator = new IfcCreator({ Name: projectName });
  const storey = creator.addIfcBuildingStorey({ Name: storeyName, Elevation: 0 });

  if (jsonInput) {
    // Read JSON params from stdin
    let input = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    const params = JSON.parse(input);
    addElement(creator, storey, elementType, params);
  } else {
    const params = parseElementParams(args, elementType);
    addElement(creator, storey, elementType, params);
  }

  const result = creator.toIfc();
  await writeFile(outPath, result.content, 'utf-8');
  process.stderr.write(`IFC written to ${outPath} (${result.stats.entityCount} entities)\n`);
}

function addElement(creator: IfcCreator, storey: number, elementType: string, params: Record<string, unknown>): void {
  switch (elementType.toLowerCase()) {
    case 'wall':
      creator.addIfcWall(storey, {
        Start: (params.Start as [number, number, number]) ?? [0, 0, 0],
        End: (params.End as [number, number, number]) ?? [5, 0, 0],
        Height: (params.Height as number) ?? 3,
        Thickness: (params.Thickness as number) ?? 0.2,
        Name: (params.Name as string) ?? 'Wall',
        ...params,
      } as any);
      break;
    case 'slab':
      creator.addIfcSlab(storey, {
        Width: (params.Width as number) ?? 10,
        Depth: (params.Depth as number) ?? 8,
        Thickness: (params.Thickness as number) ?? 0.3,
        Name: (params.Name as string) ?? 'Slab',
        ...params,
      } as any);
      break;
    case 'column':
      creator.addIfcColumn(storey, {
        Position: (params.Position as [number, number, number]) ?? [0, 0, 0],
        Height: (params.Height as number) ?? 3,
        Width: (params.Width as number) ?? 0.3,
        Depth: (params.Depth as number) ?? 0.3,
        Name: (params.Name as string) ?? 'Column',
        ...params,
      } as any);
      break;
    case 'beam':
      creator.addIfcBeam(storey, {
        Start: (params.Start as [number, number, number]) ?? [0, 0, 3],
        End: (params.End as [number, number, number]) ?? [5, 0, 3],
        Width: (params.Width as number) ?? 0.2,
        Depth: (params.Depth as number) ?? 0.4,
        Name: (params.Name as string) ?? 'Beam',
        ...params,
      } as any);
      break;
    default:
      fatal(`Unknown element type: ${elementType}. Supported: wall, slab, column, beam`);
  }
}

function parseElementParams(args: string[], _elementType: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  const numFlags = ['--height', '--thickness', '--width', '--depth', '--length', '--elevation'];
  for (const flag of numFlags) {
    const val = getFlag(args, flag);
    if (val != null) {
      const key = flag.slice(2);
      params[key.charAt(0).toUpperCase() + key.slice(1)] = parseFloat(val);
    }
  }

  const strFlags = ['--name'];
  for (const flag of strFlags) {
    const val = getFlag(args, flag);
    if (val != null) {
      const key = flag.slice(2);
      params[key.charAt(0).toUpperCase() + key.slice(1)] = val;
    }
  }

  // Parse coordinate flags
  const start = getFlag(args, '--start');
  if (start) params.Start = start.split(',').map(Number);

  const end = getFlag(args, '--end');
  if (end) params.End = end.split(',').map(Number);

  const position = getFlag(args, '--position');
  if (position) params.Position = position.split(',').map(Number);

  return params;
}
