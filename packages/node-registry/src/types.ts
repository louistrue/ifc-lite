/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Node registry types — defines what a visual node looks like.
 *
 * Every SDK function can be registered as a NodeDefinition.
 * React Flow (ifc-flow) auto-generates UI nodes from these definitions.
 * The graph-to-script compiler uses toCode() to emit TypeScript.
 */

import type { BimContext } from '@ifc-lite/sdk';

// ============================================================================
// Data Types (what flows through wires)
// ============================================================================

export type DataType =
  | 'EntityProxy'     // Single entity
  | 'EntityProxy[]'   // Array of entities
  | 'EntityRef'       // Entity reference (lightweight)
  | 'EntityRef[]'
  | 'string'
  | 'string[]'
  | 'number'
  | 'boolean'
  | 'object'          // Generic JSON object
  | 'object[]'
  | 'Lens'            // Lens definition
  | 'IDSReport'       // IDS validation report
  | 'SVG'             // SVG string
  | 'Blob'            // Binary data
  | 'any';            // Untyped (for script nodes)

// ============================================================================
// Port Definitions (inputs and outputs on a node)
// ============================================================================

export interface PortDefinition {
  /** Unique ID within the node */
  id: string;
  /** Display name */
  name: string;
  /** Data type */
  type: DataType;
  /** Is this port required for execution? */
  required: boolean;
  /** Description shown on hover */
  description?: string;
}

// ============================================================================
// Parameter Definitions (inline-editable values on a node)
// ============================================================================

export type ParamWidget =
  | 'text'            // Free text input
  | 'number'          // Number input
  | 'boolean'         // Checkbox / toggle
  | 'select'          // Dropdown
  | 'color'           // Color picker
  | 'ifc-type'        // IFC type selector (IfcWall, IfcDoor, etc.)
  | 'property-path'   // Property set + property name picker
  | 'code';           // Monaco editor (for script nodes)

export interface ParamDefinition {
  /** Unique ID within the node */
  id: string;
  /** Display name */
  name: string;
  /** Widget type for rendering */
  widget: ParamWidget;
  /** Default value */
  default?: string | number | boolean;
  /** Allowed values (for 'select' widget) */
  options?: Array<{ label: string; value: string }>;
  /** Description shown on hover */
  description?: string;
}

// ============================================================================
// Node Definition
// ============================================================================

export type NodeCategory =
  | 'Input'
  | 'Query'
  | 'Viewer'
  | 'Data'
  | 'Mutation'
  | 'Export'
  | 'Validation'
  | 'Drawing'
  | 'Analysis'
  | 'Script';

export interface NodeDefinition {
  /** Unique ID (e.g., 'query.filterByType') */
  id: string;
  /** Display name */
  name: string;
  /** Category for palette grouping */
  category: NodeCategory;
  /** Description */
  description: string;
  /** Lucide icon name (optional) */
  icon?: string;

  /** Input ports */
  inputs: PortDefinition[];
  /** Output ports */
  outputs: PortDefinition[];
  /** Inline parameters */
  params: ParamDefinition[];

  /** Execute this node — called during graph evaluation */
  execute: NodeExecutor;
  /** Generate equivalent TypeScript code */
  toCode: (params: Record<string, unknown>) => string;

  /**
   * Decompile patterns — regex(es) for recognizing this node's code in scripts.
   * When present, the decompiler uses these patterns from the registry
   * instead of maintaining a separate hardcoded pattern list.
   * Multiple patterns are supported (e.g., filterByProperty has 3 regex variants).
   * Patterns across all nodes are tried in registration order, with earlier
   * patterns in each node's array tried first.
   */
  fromCode?: FromCodePattern[];
}

/** A regex pattern for decompiling code back to a node */
export interface FromCodePattern {
  /** Regex to match the code line */
  regex: RegExp;
  /** Whether the first capture group is a variable assignment (const x = ...) */
  assigns: boolean;
  /** Extract params from regex match groups */
  extractParams: (match: RegExpMatchArray) => Record<string, unknown>;
  /** Extract input variable names from match */
  extractInputs: (match: RegExpMatchArray) => string[];
}

/** Executor function signature */
export type NodeExecutor = (
  inputs: Record<string, unknown>,
  params: Record<string, unknown>,
  sdk: BimContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

// ============================================================================
// Graph Types (for the compiler)
// ============================================================================

export interface GraphNode {
  /** Instance ID (unique within the graph) */
  id: string;
  /** Node definition ID */
  definitionId: string;
  /** Parameter values */
  params: Record<string, unknown>;
  /** Position on canvas (for visual editor) */
  position: { x: number; y: number };
}

export interface GraphEdge {
  /** Source node instance ID */
  sourceNodeId: string;
  /** Source port ID */
  sourcePortId: string;
  /** Target node instance ID */
  targetNodeId: string;
  /** Target port ID */
  targetPortId: string;
}

export interface Graph {
  /** Graph metadata */
  name: string;
  description?: string;
  /** Node instances */
  nodes: GraphNode[];
  /** Edges between ports */
  edges: GraphEdge[];
}
