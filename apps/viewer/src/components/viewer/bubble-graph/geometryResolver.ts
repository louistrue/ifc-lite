/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry resolver for BubbleGraph elements — thin wrapper over the
 * geometryLibrary.json catalogue (ported from webBubbleBIM).
 */

import geometryLibraryData from './geometryLibrary.json';
import type { BubbleGraphNode } from '@/store/slices/bubbleGraphSlice';

// ─── Types ────────────────────────────────────────────────────────────────

export interface GeometryDefinition {
  id: string;
  family: string;
  type: string;
  category: string;
  label: string;
  description: string;
  material: string;
  color: string;
  parameters: Record<string, { value: number | string; unit?: string; editable: boolean }>;
  section: Record<string, unknown>;
  extrusion: Record<string, unknown>;
}

interface GeometryLibrary {
  geometryDefinitions: GeometryDefinition[];
}

const geometryLibrary = geometryLibraryData as unknown as GeometryLibrary;

// ─── Helpers ──────────────────────────────────────────────────────────────

export function getGeometryDefinition(id: string): GeometryDefinition | undefined {
  return geometryLibrary.geometryDefinitions.find((d) => d.id === id);
}

export function getGeometriesByFamily(family: string): GeometryDefinition[] {
  return geometryLibrary.geometryDefinitions.filter((d) => d.family === family);
}

export function getGeometriesByCategory(category: string): GeometryDefinition[] {
  return geometryLibrary.geometryDefinitions.filter((d) => d.category === category);
}

/** Height of a storey in mm (topElevation − bottomElevation). */
export function getStoreyHeight(storeyNode: BubbleGraphNode): number {
  const bot = (storeyNode.properties.bottomElevation as number) ?? 0;
  const top = (storeyNode.properties.topElevation as number) ?? 3000;
  return top - bot;
}

/** Find the parent storey for any node. */
export function findParentStorey(
  nodeId: string,
  allNodes: BubbleGraphNode[],
): BubbleGraphNode | undefined {
  const node = allNodes.find((n) => n.id === nodeId);
  if (!node?.parentId) return undefined;
  return allNodes.find((n) => n.id === node.parentId && n.type === 'storey');
}

/** 3-D world position of a node (mm), accounting for storey elevation. */
export function getNode3DPosition(
  node: BubbleGraphNode,
  allNodes: BubbleGraphNode[],
): { x: number; y: number; z: number } {
  const storey = findParentStorey(node.id, allNodes);
  const elevation = (storey?.properties.bottomElevation as number) ?? 0;

  if (node.type === 'ax' && storey) {
    const axesX = storey.properties.axesX as number[] | undefined;
    const axesY = storey.properties.axesY as number[] | undefined;

    if (axesX && axesY && axesX.length > 0 && axesY.length > 0) {
      const gx = node.properties.gridX as number | undefined;
      const gy = node.properties.gridY as number | undefined;
      if (gx !== undefined && gy !== undefined) {
        const realX = axesX[gx] ?? node.x;
        const realY = axesY[gy] ?? node.y;
        return { x: realX, y: realY, z: elevation };
      }
    }
  }

  return { x: node.x, y: node.y, z: elevation };
}
