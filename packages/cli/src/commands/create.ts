/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite create <element-type> [options] --out <file.ifc>
 *
 * Create IFC files programmatically from CLI arguments.
 * Supports all 24+ element types from IfcCreator, plus property sets,
 * quantities, materials, and colors.
 *
 * Element types:
 *   wall, slab, column, beam, stair, roof, gable-roof, door, window,
 *   wall-door, wall-window, ramp, railing, plate, member, footing, pile,
 *   space, curtain-wall, furnishing, proxy, circular-column,
 *   hollow-circular-column, i-shape-beam, l-shape-member, t-shape-member,
 *   u-shape-member, rectangle-hollow-beam
 */

import { writeFile } from 'node:fs/promises';
import { IfcCreator } from '@ifc-lite/create';
import { getFlag, hasFlag, fatal, printJson } from '../output.js';

export const ELEMENT_TYPES = [
  'wall', 'slab', 'column', 'beam', 'stair', 'roof', 'gable-roof',
  'door', 'window', 'wall-door', 'wall-window', 'ramp', 'railing',
  'plate', 'member', 'footing', 'pile', 'space', 'curtain-wall',
  'furnishing', 'proxy', 'circular-column', 'hollow-circular-column',
  'i-shape-beam', 'l-shape-member', 't-shape-member', 'u-shape-member',
  'rectangle-hollow-beam', 'storey',
];

export async function createCommand(args: string[]): Promise<void> {
  const elementType = args.find(a => !a.startsWith('-'));
  if (!elementType) {
    fatal(`Usage: ifc-lite create <type> [options] --out <file.ifc>\n\nTypes: ${ELEMENT_TYPES.join(', ')}`);
  }

  const outPath = getFlag(args, '--out');
  const viewerPort = getFlag(args, '--viewer');

  const projectName = getFlag(args, '--project') ?? 'CLI Project';
  const storeyName = getFlag(args, '--storey') ?? 'Ground Floor';
  const storeyElevation = parseFloat(getFlag(args, '--elevation') ?? '0');
  const jsonInput = hasFlag(args, '--from-json');
  const jsonOutput = hasFlag(args, '--json');

  const creator = new IfcCreator({ Name: projectName });
  const storey = creator.addIfcBuildingStorey({ Name: storeyName, Elevation: storeyElevation });

  let params: Record<string, unknown>;
  if (jsonInput) {
    let input = '';
    process.stdin.setEncoding('utf-8');
    for await (const chunk of process.stdin) {
      input += chunk;
    }
    params = JSON.parse(input);
  } else {
    params = parseElementParams(args);
  }

  const elementId = addElement(creator, storey, elementType, params);

  // Post-creation: property sets, quantities, materials, colors
  const psetJson = getFlag(args, '--pset');
  if (psetJson) {
    const pset = JSON.parse(psetJson);
    creator.addIfcPropertySet(elementId, pset);
  }

  const qsetJson = getFlag(args, '--qset');
  if (qsetJson) {
    const qset = JSON.parse(qsetJson);
    creator.addIfcElementQuantity(elementId, qset);
  }

  const materialJson = getFlag(args, '--material');
  if (materialJson) {
    const mat = JSON.parse(materialJson);
    creator.addIfcMaterial(elementId, mat);
  }

  const colorStr = getFlag(args, '--color');
  if (colorStr) {
    const parts = colorStr.split(',').map(Number);
    if (parts.length === 3) {
      creator.setColor(elementId, 'CustomColor', parts as [number, number, number]);
    }
  }

  const result = creator.toIfc();

  // Write to file (if --out specified)
  if (outPath) {
    await writeFile(outPath, result.content, 'utf-8');
  }

  // Stream to viewer (if --viewer specified)
  if (viewerPort) {
    const port = parseInt(viewerPort, 10);
    try {
      const resp = await fetch(`http://localhost:${port}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addGeometry',
          ifcContent: result.content,
        }),
      });
      const status = (await resp.json()) as { ok: boolean; error?: string };
      if (status.ok) {
        process.stderr.write(`Streamed to viewer on port ${port}\n`);
      } else {
        process.stderr.write(`Viewer error: ${status.error}\n`);
      }
    } catch {
      process.stderr.write(`Could not connect to viewer on port ${port}\n`);
    }
  }

  if (!outPath && !viewerPort) {
    fatal('--out or --viewer is required for create command');
  }

  if (jsonOutput) {
    printJson({
      file: outPath ?? null,
      entityCount: result.stats.entityCount,
      fileSize: result.stats.fileSize,
      entities: result.entities,
      streamedToViewer: !!viewerPort,
    });
  } else if (outPath) {
    process.stderr.write(`IFC written to ${outPath} (${result.stats.entityCount} entities)\n`);
  }
}

export function addElement(creator: IfcCreator, storey: number, elementType: string, params: Record<string, unknown>): number {
  const p = params;
  switch (elementType.toLowerCase()) {
    case 'wall':
      return creator.addIfcWall(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [5, 0, 0],
        Height: (p.Height as number) ?? 3,
        Thickness: (p.Thickness as number) ?? 0.2,
        Name: (p.Name as string) ?? 'Wall',
        ...p,
      } as any);
    case 'slab':
      return creator.addIfcSlab(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 10,
        Depth: (p.Depth as number) ?? 8,
        Thickness: (p.Thickness as number) ?? 0.3,
        Name: (p.Name as string) ?? 'Slab',
        ...p,
      } as any);
    case 'column':
      return creator.addIfcColumn(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Height: (p.Height as number) ?? 3,
        Width: (p.Width as number) ?? 0.3,
        Depth: (p.Depth as number) ?? 0.3,
        Name: (p.Name as string) ?? 'Column',
        ...p,
      } as any);
    case 'beam':
      return creator.addIfcBeam(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 3],
        End: (p.End as [number, number, number]) ?? [5, 0, 3],
        Width: (p.Width as number) ?? 0.2,
        Height: (p.Height as number) ?? 0.4,
        Name: (p.Name as string) ?? 'Beam',
        ...p,
      } as any);
    case 'stair':
      return creator.addIfcStair(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        NumberOfRisers: (p.NumberOfRisers as number) ?? 12,
        RiserHeight: (p.RiserHeight as number) ?? 0.175,
        TreadLength: (p.TreadLength as number) ?? 0.28,
        Width: (p.Width as number) ?? 1.2,
        Direction: (p.Direction as number) ?? undefined,
        Name: (p.Name as string) ?? 'Stair',
        ...p,
      } as any);
    case 'roof':
      return creator.addIfcRoof(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 3],
        Width: (p.Width as number) ?? 10,
        Depth: (p.Depth as number) ?? 8,
        Thickness: (p.Thickness as number) ?? 0.25,
        Slope: (p.Slope as number) ?? undefined,
        Name: (p.Name as string) ?? 'Roof',
        ...p,
      } as any);
    case 'gable-roof':
      return creator.addIfcGableRoof(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 3],
        Width: (p.Width as number) ?? 10,
        Depth: (p.Depth as number) ?? 8,
        Thickness: (p.Thickness as number) ?? 0.25,
        Slope: (p.Slope as number) ?? 0.5,
        Overhang: (p.Overhang as number) ?? undefined,
        Name: (p.Name as string) ?? 'Gable Roof',
        ...p,
      } as any);
    case 'door':
      return creator.addIfcDoor(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 0.9,
        Height: (p.Height as number) ?? 2.1,
        Thickness: (p.Thickness as number) ?? undefined,
        PredefinedType: (p.PredefinedType as string) ?? undefined,
        OperationType: (p.OperationType as string) ?? undefined,
        Name: (p.Name as string) ?? 'Door',
        ...p,
      } as any);
    case 'window':
      return creator.addIfcWindow(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 1],
        Width: (p.Width as number) ?? 1.2,
        Height: (p.Height as number) ?? 1.5,
        Thickness: (p.Thickness as number) ?? undefined,
        PartitioningType: (p.PartitioningType as string) ?? undefined,
        Name: (p.Name as string) ?? 'Window',
        ...p,
      } as any);
    case 'wall-door': {
      const wallId = (p.WallId as number);
      if (!wallId) fatal('wall-door requires --wall-id (expressId of the host wall)');
      return creator.addIfcWallDoor(wallId, {
        Position: (p.Position as [number, number, number]) ?? [1, 0, 0],
        Width: (p.Width as number) ?? 0.9,
        Height: (p.Height as number) ?? 2.1,
        Name: (p.Name as string) ?? 'Door',
        ...p,
      } as any);
    }
    case 'wall-window': {
      const wallId = (p.WallId as number);
      if (!wallId) fatal('wall-window requires --wall-id (expressId of the host wall)');
      return creator.addIfcWallWindow(wallId, {
        Position: (p.Position as [number, number, number]) ?? [1, 0, 1],
        Width: (p.Width as number) ?? 1.2,
        Height: (p.Height as number) ?? 1.5,
        Name: (p.Name as string) ?? 'Window',
        ...p,
      } as any);
    }
    case 'ramp':
      return creator.addIfcRamp(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 1.5,
        Length: (p.Length as number) ?? 5,
        Thickness: (p.Thickness as number) ?? 0.2,
        Rise: (p.Rise as number) ?? undefined,
        Name: (p.Name as string) ?? 'Ramp',
        ...p,
      } as any);
    case 'railing':
      return creator.addIfcRailing(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [5, 0, 0],
        Height: (p.Height as number) ?? 1.0,
        Width: (p.Width as number) ?? undefined,
        Name: (p.Name as string) ?? 'Railing',
        ...p,
      } as any);
    case 'plate':
      return creator.addIfcPlate(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 2,
        Depth: (p.Depth as number) ?? 1,
        Thickness: (p.Thickness as number) ?? 0.01,
        Name: (p.Name as string) ?? 'Plate',
        ...p,
      } as any);
    case 'member':
      return creator.addIfcMember(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [3, 0, 3],
        Width: (p.Width as number) ?? 0.1,
        Height: (p.Height as number) ?? 0.1,
        Name: (p.Name as string) ?? 'Member',
        ...p,
      } as any);
    case 'footing':
      return creator.addIfcFooting(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 2,
        Depth: (p.Depth as number) ?? 2,
        Height: (p.Height as number) ?? 0.5,
        PredefinedType: (p.PredefinedType as string) ?? undefined,
        Name: (p.Name as string) ?? 'Footing',
        ...p,
      } as any);
    case 'pile':
      return creator.addIfcPile(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Length: (p.Length as number) ?? 10,
        Diameter: (p.Diameter as number) ?? 0.6,
        IsRectangular: (p.IsRectangular as boolean) ?? undefined,
        Name: (p.Name as string) ?? 'Pile',
        ...p,
      } as any);
    case 'space':
      return creator.addIfcSpace(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 5,
        Depth: (p.Depth as number) ?? 4,
        Height: (p.Height as number) ?? 3,
        LongName: (p.LongName as string) ?? undefined,
        Name: (p.Name as string) ?? 'Space',
        ...p,
      } as any);
    case 'curtain-wall':
      return creator.addIfcCurtainWall(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [10, 0, 0],
        Height: (p.Height as number) ?? 3,
        Thickness: (p.Thickness as number) ?? undefined,
        Name: (p.Name as string) ?? 'Curtain Wall',
        ...p,
      } as any);
    case 'furnishing':
      return creator.addIfcFurnishingElement(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 1,
        Depth: (p.Depth as number) ?? 0.6,
        Height: (p.Height as number) ?? 0.8,
        Direction: (p.Direction as number) ?? undefined,
        Name: (p.Name as string) ?? 'Furnishing',
        ...p,
      } as any);
    case 'proxy':
      return creator.addIfcBuildingElementProxy(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Width: (p.Width as number) ?? 1,
        Depth: (p.Depth as number) ?? 1,
        Height: (p.Height as number) ?? 1,
        ProxyType: (p.ProxyType as string) ?? undefined,
        Name: (p.Name as string) ?? 'Proxy',
        ...p,
      } as any);
    case 'circular-column':
      return creator.addIfcCircularColumn(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Radius: (p.Radius as number) ?? 0.15,
        Height: (p.Height as number) ?? 3,
        Name: (p.Name as string) ?? 'Circular Column',
        ...p,
      } as any);
    case 'hollow-circular-column':
      return creator.addIfcHollowCircularColumn(storey, {
        Position: (p.Position as [number, number, number]) ?? [0, 0, 0],
        Radius: (p.Radius as number) ?? 0.3,
        WallThickness: (p.WallThickness as number) ?? 0.02,
        Height: (p.Height as number) ?? 3,
        Name: (p.Name as string) ?? 'Hollow Circular Column',
        ...p,
      } as any);
    case 'i-shape-beam':
      return creator.addIfcIShapeBeam(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 3],
        End: (p.End as [number, number, number]) ?? [5, 0, 3],
        OverallWidth: (p.OverallWidth as number) ?? 0.2,
        OverallDepth: (p.OverallDepth as number) ?? 0.4,
        WebThickness: (p.WebThickness as number) ?? 0.01,
        FlangeThickness: (p.FlangeThickness as number) ?? 0.015,
        FilletRadius: (p.FilletRadius as number) ?? undefined,
        Name: (p.Name as string) ?? 'I-Shape Beam',
        ...p,
      } as any);
    case 'l-shape-member':
      return creator.addIfcLShapeMember(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [3, 0, 3],
        Depth: (p.Depth as number) ?? 0.1,
        Width: (p.Width as number) ?? 0.1,
        Thickness: (p.Thickness as number) ?? 0.01,
        Name: (p.Name as string) ?? 'L-Shape Member',
        ...p,
      } as any);
    case 't-shape-member':
      return creator.addIfcTShapeMember(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [3, 0, 3],
        FlangeWidth: (p.FlangeWidth as number) ?? 0.15,
        Depth: (p.Depth as number) ?? 0.15,
        WebThickness: (p.WebThickness as number) ?? 0.008,
        FlangeThickness: (p.FlangeThickness as number) ?? 0.012,
        Name: (p.Name as string) ?? 'T-Shape Member',
        ...p,
      } as any);
    case 'u-shape-member':
      return creator.addIfcUShapeMember(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 0],
        End: (p.End as [number, number, number]) ?? [3, 0, 3],
        Depth: (p.Depth as number) ?? 0.15,
        FlangeWidth: (p.FlangeWidth as number) ?? 0.08,
        WebThickness: (p.WebThickness as number) ?? 0.008,
        FlangeThickness: (p.FlangeThickness as number) ?? 0.01,
        Name: (p.Name as string) ?? 'U-Shape Member',
        ...p,
      } as any);
    case 'rectangle-hollow-beam':
      return creator.addIfcRectangleHollowBeam(storey, {
        Start: (p.Start as [number, number, number]) ?? [0, 0, 3],
        End: (p.End as [number, number, number]) ?? [5, 0, 3],
        XDim: (p.XDim as number) ?? 0.1,
        YDim: (p.YDim as number) ?? 0.2,
        WallThickness: (p.WallThickness as number) ?? 0.005,
        Name: (p.Name as string) ?? 'Rectangle Hollow Beam',
        ...p,
      } as any);
    default:
      fatal(`Unknown element type: ${elementType}\n\nSupported: ${ELEMENT_TYPES.join(', ')}`);
  }
}

function parseElementParams(args: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  const numFlags = [
    '--height', '--thickness', '--width', '--depth', '--length',
    '--radius', '--wall-thickness', '--diameter',
    '--overall-width', '--overall-depth', '--web-thickness', '--flange-thickness',
    '--fillet-radius', '--flange-width',
    '--number-of-risers', '--riser-height', '--tread-length',
    '--slope', '--overhang', '--rise', '--direction',
    '--xdim', '--ydim',
  ];
  for (const flag of numFlags) {
    const val = getFlag(args, flag);
    if (val != null) {
      const key = flagToKey(flag);
      params[key] = parseFloat(val);
    }
  }

  const strFlags = ['--name', '--description', '--object-type', '--tag', '--long-name',
    '--predefined-type', '--operation-type', '--partitioning-type', '--proxy-type'];
  for (const flag of strFlags) {
    const val = getFlag(args, flag);
    if (val != null) {
      const key = flagToKey(flag);
      params[key] = val;
    }
  }

  // Boolean flags
  if (hasFlag(args, '--is-rectangular')) params.IsRectangular = true;

  // Integer flags
  const wallId = getFlag(args, '--wall-id');
  if (wallId) params.WallId = parseInt(wallId, 10);

  // Parse coordinate flags
  const start = getFlag(args, '--start');
  if (start) params.Start = start.split(',').map(Number);

  const end = getFlag(args, '--end');
  if (end) params.End = end.split(',').map(Number);

  const position = getFlag(args, '--position');
  if (position) params.Position = position.split(',').map(Number);

  return params;
}

/** Convert --kebab-flag to PascalCase key */
function flagToKey(flag: string): string {
  return flag.slice(2).split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}
