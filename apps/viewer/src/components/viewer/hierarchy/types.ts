/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/** Node types for the hierarchy tree */
export type NodeType =
  | 'unified-storey'      // Grouped storey across models (multi-model only)
  | 'model-header'        // Model visibility control (section header or individual model)
  | 'IfcProject'          // Project node
  | 'IfcSite'             // Site node
  | 'IfcBuilding'         // Building node
  | 'IfcBuildingStorey'   // Storey node
  | 'type-group'          // IFC class grouping header (e.g., "IfcWall (47)")
  | 'element';            // Individual element

export interface TreeNode {
  id: string;  // Unique ID for the node (can be composite)
  /** Express IDs this node represents (for elements/storeys) */
  expressIds: number[];
  /** Model IDs this node belongs to */
  modelIds: string[];
  name: string;
  type: NodeType;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isVisible: boolean; // Note: For storeys, computed lazily during render for performance
  elementCount?: number;
  storeyElevation?: number;
  /** Internal: ID offset for lazy visibility computation */
  _idOffset?: number;
}

/** Data for a storey from a single model */
export interface StoreyData {
  modelId: string;
  storeyId: number;
  name: string;
  elevation: number;
  elements: number[];
}

/** Unified storey grouping storeys from multiple models */
export interface UnifiedStorey {
  key: string;  // Elevation-based key for matching
  name: string;
  elevation: number;
  storeys: StoreyData[];
  totalElements: number;
}

// Spatial container types (Project/Site/Building) - these don't have direct visibility toggles
const SPATIAL_CONTAINER_TYPES: Set<NodeType> = new Set(['IfcProject', 'IfcSite', 'IfcBuilding']);
export const isSpatialContainer = (type: NodeType): boolean => SPATIAL_CONTAINER_TYPES.has(type);
