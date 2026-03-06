/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * BubbleGraph → IFC converter.
 *
 * Translates the relational building graph into an IFC4 STEP file using
 * the @ifc-lite/create package.  Coordinate convention: BubbleGraph stores
 * positions in **millimetres** (mm); IFC uses **metres** (m).
 *
 * Supported mappings
 *  ax  + has_column=True  → IfcColumn  (section from geometryLibrary)
 *  wall                   → IfcWall    (thickness from geometryLibrary)
 *    ↳ connected window   → IfcWall.Openings (void cut) + IfcOpeningElement box
 *    ↳ connected door     → IfcWall.Openings (void cut) + IfcOpeningElement box
 *  beam                   → IfcBeam    (section from geometryLibrary)
 *  room / shell           → IfcSpace
 *  slab                   → IfcSlab
 *  storey                 → IfcBuildingStorey
 */

import { IfcCreator } from '@ifc-lite/create';
import type { RectangularOpening } from '@ifc-lite/create';
import type { BubbleGraphNode, BubbleGraphEdge } from '@/store/slices/bubbleGraphSlice';
import { getGeometryDefinition } from './geometryResolver';

// ─── Unit helpers ─────────────────────────────────────────────────────────

/** mm → m */
const mm = (v: number): number => v / 1000;

/**
 * Read a dimension from the geometry library `section` object.
 * Falls back to `fallbackM` (metres) when not found.
 */
function geomDim(
  id: string,
  key: 'width' | 'depth' | 'height' | 'thickness',
  fallbackM: number,
): number {
  const geom = getGeometryDefinition(id);
  if (!geom?.section) return fallbackM;
  const raw = (geom.section as Record<string, unknown>)[key];
  return typeof raw === 'number' ? raw / 1000 : fallbackM;
}

// ─── Main export ──────────────────────────────────────────────────────────

/**
 * Generate an IFC File from BubbleGraph nodes + edges.
 *
 * @param nodes        All BubbleGraph nodes
 * @param edges        All BubbleGraph edges
 * @param projectName  IFC project name (used as filename too)
 * @param buildingAxes Global axis grid positions (xValues, yValues in mm)
 * @returns            A `File` ready to pass to `loadFile()`
 */
export function generateIfcFromGraph(
  nodes: BubbleGraphNode[],
  edges: BubbleGraphEdge[],
  projectName = 'Untitled Project',
  buildingAxes?: { xValues: number[]; yValues: number[] },
): File {
  const creator = new IfcCreator({
    Name: projectName,
    SiteName: 'Site',
    BuildingName: 'Building',
    Schema: 'IFC4',
  });

  const storeyNodes = nodes.filter((n) => n.type === 'storey');

  for (const storey of storeyNodes) {
    const bottomElevM = mm((storey.properties.bottomElevation as number) ?? 0);
    const topElevM    = mm((storey.properties.topElevation   as number) ?? 3000);
    const storeyH     = topElevM - bottomElevM;

    const storeyId = creator.addIfcBuildingStorey({
      Name: storey.name,
      Elevation: bottomElevM,
    });

    // All direct children of this storey
    const children = nodes.filter((n) => n.parentId === storey.id);
    const childSet  = new Set(children.map((n) => n.id));

    // Build adjacency map (child-level only)
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!childSet.has(e.from) || !childSet.has(e.to)) continue;
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to))   adj.set(e.to,   []);
      adj.get(e.from)!.push(e.to);
      adj.get(e.to)!.push(e.from);
    }
    const nbrs = (id: string) => adj.get(id) ?? [];

    // ── IfcColumn — ax nodes with has_column = true ─────────────────────
    console.log('[IFC] Building axes:', buildingAxes);
    for (const ax of children.filter((n) => n.type === 'ax')) {
      const hasCol = ax.properties.has_column;
      if (hasCol !== 'True' && hasCol !== true) continue;

      const colType = (ax.properties.column_type as string) ?? 'C25x25';
      
      // Determine column position:
      // If buildingAxes is provided and ax has gridX/gridY,
      // use the real global axis coordinates.
      // Otherwise fall back to canvas position.
      let posX = mm(ax.x), posY = mm(ax.y);
      const gx = ax.properties.gridX as number | undefined;
      const gy = ax.properties.gridY as number | undefined;
      console.log(`[IFC] Column ${ax.name}: gridX=${gx}, gridY=${gy}, canvasPos=[${mm(ax.x)}, ${mm(ax.y)}]`);
      
      if (buildingAxes && buildingAxes.xValues.length > 0 && buildingAxes.yValues.length > 0) {
        if (gx != null && gy != null && gx < buildingAxes.xValues.length && gy < buildingAxes.yValues.length) {
          posX = mm(buildingAxes.xValues[gx]);
          posY = mm(buildingAxes.yValues[gy]);
          console.log(`  → Using buildingAxes: [${posX}, ${posY}]`);
        } else {
          console.log(`  → Grid indices out of range or missing`);
        }
      } else {
        console.log(`  → No buildingAxes, fallback to canvas`);
      }

      creator.addIfcColumn(storeyId, {
        Name: `COL-${ax.name}`,
        Position: [posX, posY, bottomElevM],
        Width:  geomDim(colType, 'width',  0.25),
        Depth:  geomDim(colType, 'depth',  0.25),
        Height: storeyH,
      });
    }

    // ── IfcWall — wall nodes connected to two ax nodes ───────────────────
    for (const wall of children.filter((n) => n.type === 'wall')) {
      const neighbors   = nbrs(wall.id);
      const axNeighbors = nodes
        .filter((n) => neighbors.includes(n.id) && n.type === 'ax')
        .slice(0, 2);
      if (axNeighbors.length < 2) continue;

      const [axA, axB] = axNeighbors;
      const wallType   = (wall.properties.wall_type as string) ?? 'W20';
      const thickness  = geomDim(wallType, 'thickness', 0.2);

      // Auto-beam on top: has_beam=True → generate an IfcBeam and reduce wall height
      const hasBeam = wall.properties.has_beam === 'True' || wall.properties.has_beam === true;
      const beamTypeStr = (wall.properties.beam_type as string) ?? '';
      // Default beam section 0.25 × 0.25 m; override via beam_type geometry entry
      const autoBeamW = beamTypeStr ? geomDim(beamTypeStr, 'width',  0.25) : 0.25;
      const autoBeamH = beamTypeStr ? geomDim(beamTypeStr, 'height', 0.25) : 0.25;

      // Wall height: explicit > (storeyH - beamH when hasBeam) > storeyH
      let wallHeight: number;
      if (wall.properties.height != null) {
        wallHeight = mm(wall.properties.height as number);
      } else if (hasBeam) {
        wallHeight = Math.max(0.1, storeyH - autoBeamH);
      } else {
        wallHeight = storeyH;
      }

      // Use building axes coordinates if available, otherwise fall back to canvas position
      let wxA = mm(axA.x), wyA = mm(axA.y);
      let wxB = mm(axB.x), wyB = mm(axB.y);

      if (buildingAxes) {
        const gxA = axA.properties.gridX as number | undefined;
        const gyA = axA.properties.gridY as number | undefined;
        if (gxA != null && gyA != null && gxA < buildingAxes.xValues.length && gyA < buildingAxes.yValues.length) {
          wxA = mm(buildingAxes.xValues[gxA]);
          wyA = mm(buildingAxes.yValues[gyA]);
        }
        const gxB = axB.properties.gridX as number | undefined;
        const gyB = axB.properties.gridY as number | undefined;
        if (gxB != null && gyB != null && gxB < buildingAxes.xValues.length && gyB < buildingAxes.yValues.length) {
          wxB = mm(buildingAxes.xValues[gxB]);
          wyB = mm(buildingAxes.yValues[gyB]);
        }
      }
      const wLen = Math.hypot(wxB - wxA, wyB - wyA);
      const dirX = wLen > 0 ? (wxB - wxA) / wLen : 1;
      const dirY = wLen > 0 ? (wyB - wyA) / wLen : 0;

      // Window / door nodes directly connected to this wall node
      const openingNodes = nodes.filter(
        (n) => neighbors.includes(n.id) && (n.type === 'window' || n.type === 'door'),
      );

      /**
       * Resolve opening X-offset along wall axis (m).
       * Uses explicit `wall_offset` property (mm) when set;
       * otherwise projects the node's canvas position onto the wall axis.
       */
      const resolveOffset = (o: BubbleGraphNode): number => {
        const raw = o.properties.wall_offset;
        if (raw != null) {
          const v = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
          if (!isNaN(v)) return mm(v);
        }
        return (mm(o.x) - wxA) * dirX + (mm(o.y) - wyA) * dirY;
      };

      // Build WallParams.Openings (cuts the wall solid via IfcRelVoidsElement)
      const openings: RectangularOpening[] = [];
      for (const o of openingNodes) {
        const oW   = mm((o.properties.width       as number) ?? (o.type === 'window' ? 1000 :  900));
        const oH   = mm((o.properties.height      as number) ?? (o.type === 'window' ? 1200 : 2100));
        const sill = mm((o.properties.sill_height as number) ?? (o.type === 'window' ?  900 :    0));
        const dist = resolveOffset(o);
        // Position = opening centre in wall-local frame [X along wall, Y through thickness, Z up]
        openings.push({ Name: o.name, Width: oW, Height: oH, Position: [dist, 0, sill + oH / 2] });
      }

      creator.addIfcWall(storeyId, {
        Name:      wall.name,
        Start:     [wxA, wyA, bottomElevM],
        End:       [wxB, wyB, bottomElevM],
        Thickness: thickness,
        Height:    wallHeight,
        Openings:  openings.length > 0 ? openings : undefined,
      });

      // IfcOpeningElement box for each window/door (world-coordinate placement).
      // The box is placed along the wall axis — exact for axis-aligned walls,
      // approximate for diagonal walls (the RectangularOpening void cut is exact).
      for (const o of openingNodes) {
        const oW   = mm((o.properties.width       as number) ?? (o.type === 'window' ? 1000 :  900));
        const oH   = mm((o.properties.height      as number) ?? (o.type === 'window' ? 1200 : 2100));
        const sill = mm((o.properties.sill_height as number) ?? (o.type === 'window' ?  900 :    0));
        const dist = resolveOffset(o);

        // Centre of opening in world XY, then offset to bottom-left corner of box
        const ocX = wxA + dist * dirX;
        const ocY = wyA + dist * dirY;
        // Perpendicular (normal) to wall in XY plane
        const normX = -dirY;
        const normY =  dirX;
        creator.addIfcOpeningElement(storeyId, {
          Name:     `${o.type === 'window' ? 'WIN' : 'DR'}-${o.name}`,
          // bottom-left of box = centre shifted by half-width along wall + half-thickness across wall
          Position: [
            ocX - (oW / 2) * dirX - (thickness / 2) * normX,
            ocY - (oW / 2) * dirY - (thickness / 2) * normY,
            bottomElevM + sill,
          ],
          Width:  oW,
          Height: oH,
          Depth:  thickness,
        });
      }

      // Auto-beam on top of wall (runs from axA to axB at post-wall elevation)
      if (hasBeam) {
        creator.addIfcBeam(storeyId, {
          Name:   `BM-${wall.name}`,
          Start:  [wxA, wyA, bottomElevM + wallHeight],
          End:    [wxB, wyB, bottomElevM + wallHeight],
          Width:  autoBeamW,
          Height: autoBeamH,
        });
      }
    }

    // ── IfcBeam — beam nodes connected to two ax nodes ───────────────────
    for (const beam of children.filter((n) => n.type === 'beam')) {
      const neighbors   = nbrs(beam.id);
      const axNeighbors = nodes
        .filter((n) => neighbors.includes(n.id) && n.type === 'ax')
        .slice(0, 2);
      if (axNeighbors.length < 2) continue;

      const [axA, axB] = axNeighbors;
      const beamType   = (beam.properties.beam_type as string) ?? 'B30x60';
      const beamWidth  = geomDim(beamType, 'width',  0.3);
      const beamHeight = geomDim(beamType, 'height', 0.6);

      creator.addIfcBeam(storeyId, {
        Name:   beam.name,
        Start:  [mm(axA.x), mm(axA.y), topElevM],
        End:    [mm(axB.x), mm(axB.y), topElevM],
        Width:  beamWidth,
        Height: beamHeight,
      });
    }

    // ── IfcSpace — room / shell nodes ────────────────────────────────────
    for (const room of children.filter((n) => n.type === 'room' || n.type === 'shell')) {
      const rW = mm((room.properties.width  as number) ?? 5000);
      const rD = mm((room.properties.depth  as number) ?? 5000);
      const rH = room.properties.height
        ? mm(room.properties.height as number)
        : storeyH;

      creator.addIfcSpace(storeyId, {
        Name:     room.name,
        Position: [mm(room.x) - rW / 2, mm(room.y) - rD / 2, bottomElevM],
        Width:    rW,
        Depth:    rD,
        Height:   rH,
      });
    }

    // ── IfcSlab — slab nodes ─────────────────────────────────────────────
    for (const slab of children.filter((n) => n.type === 'slab')) {
      const slabType = (slab.properties.slab_type as string) ?? 'SLAB15';
      const sW = mm((slab.properties.width as number) ?? 5000);
      const sD = mm((slab.properties.depth as number) ?? 5000);

      creator.addIfcSlab(storeyId, {
        Name:      slab.name,
        Position:  [mm(slab.x) - sW / 2, mm(slab.y) - sD / 2, bottomElevM],
        Width:     sW,
        Depth:     sD,
        Thickness: geomDim(slabType, 'thickness', 0.15),
      });
    }
  }

  const result   = creator.toIfc();
  const safeName = (projectName || 'bubble-graph').trim().replace(/[^a-zA-Z0-9_-]+/g, '_');
  return new File([result.content], `${safeName}.ifc`, { type: 'application/x-step' });
}
