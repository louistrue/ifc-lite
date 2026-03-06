/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * NodeRegistry — declarative node definition + auto-component generation.
 *
 * Usage (create a new node in one file):
 *
 *   import { NodeRegistry } from './registry';
 *   import { MyIcon } from 'lucide-react';
 *
 *   NodeRegistry.register({
 *     type: 'myNode',
 *     label: 'My Node',
 *     icon: MyIcon,
 *     headerClass: 'bg-violet-600',
 *     iconColor: 'text-violet-500',
 *     fields: [
 *       { id: 'name',  label: 'Name',   type: 'text',   defaultValue: '' },
 *       { id: 'value', label: 'Value',  type: 'number', defaultValue: 1, step: 0.5 },
 *     ],
 *     handles: [
 *       { type: 'target', position: 'left',  color: '#a855f7' },
 *       { type: 'source', position: 'right', color: '#6366f1' },
 *     ],
 *   }, {
 *     compileHandler: (data, storeyId, creator) => {
 *       creator.addIfcWall(storeyId, { ... });
 *     },
 *   });
 *
 *  Then import the file as a side-effect inside NodeEditorPanel.tsx.
 */

import React from 'react';
import {
  Handle,
  Position,
  useReactFlow,
  type NodeProps,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import type { LucideIcon } from 'lucide-react';
import { BaseNode, NodeField, NodeInput } from './BaseNode';
import type { IfcCreator } from '@ifc-lite/create';

// ─── Field definition ──────────────────────────────────────────────────────

export type FieldType = 'text' | 'number' | 'textarea' | 'select';

export interface FieldDef {
  /** Key matched to node data object */
  id: string;
  /** Label shown left of the field */
  label: string;
  type?: FieldType;
  defaultValue: string | number;
  /** Step for number inputs */
  step?: number;
  placeholder?: string;
  /** Options for select fields */
  options?: { value: string; label: string }[];
}

// ─── Handle definition ─────────────────────────────────────────────────────

export type HandlePos = 'left' | 'right' | 'top' | 'bottom';

export interface HandleDef {
  /** Optional ReactFlow handle id (required when multiple handles on same side) */
  id?: string;
  type: 'source' | 'target';
  position: HandlePos;
  /** CSS color for the handle dot */
  color?: string;
}

// ─── Node definition ───────────────────────────────────────────────────────

export interface NodeDef {
  /** Unique type key — matches ReactFlow node.type */
  type: string;
  /** Human-readable name shown in palette and node header */
  label: string;
  /** Lucide component or emoji string for the palette icon */
  icon: LucideIcon | string;
  /** Tailwind class for the card header background */
  headerClass: string;
  /** Tailwind color class for the palette icon, e.g. 'text-emerald-500' */
  iconColor?: string;
  /** Optional subtitle shown under the header title */
  subtitle?: string;
  /** Palette grouping label (for future collapsible sections) */
  category?: string;
  /** Editable fields rendered on the node card */
  fields: FieldDef[];
  /** ReactFlow connection handles */
  handles: HandleDef[];
}

// ─── Compile handler ───────────────────────────────────────────────────────

/**
 * Graph-level context passed to every compile handler so nodes can inspect
 * their connections at compile time (e.g. to read a connected FileInputNode).
 */
export interface CompileCtx {
  /** All nodes currently in the graph. */
  nodes: Node[];
  /** All edges currently in the graph. */
  edges: Edge[];
  /** The id of the element node being compiled. */
  nodeId: string;
}

/**
 * Called by compileGraphToIfc() for each element node wired to a storey.
 * Can be async (e.g. for nodes that fetch external data).
 * `ctx` gives access to the full graph so handlers can read connected nodes.
 */
export type CompileElementFn = (
  nodeData: Record<string, unknown>,
  storeyId: number,
  creator: IfcCreator,
  ctx: CompileCtx,
) => void | Promise<void>;

// ─── Palette item ──────────────────────────────────────────────────────────

export interface PaletteItem {
  type: string;
  label: string;
  icon: LucideIcon | string;
  iconColor: string;
  category?: string;
}

// ─── Registry ─────────────────────────────────────────────────────────────

const POS_MAP: Record<HandlePos, Position> = {
  left:   Position.Left,
  right:  Position.Right,
  top:    Position.Top,
  bottom: Position.Bottom,
};

export interface RegisterOpts {
  /**
   * Provide a hand-crafted React component instead of auto-generating one
   * from the field/handle spec. Used to migrate existing node components.
   */
  component?: React.ComponentType<NodeProps<Node<Record<string, unknown>>>>;
  /**
   * Called by compileGraphToIfc() when this node type appears as an element
   * of a storey in the graph.
   */
  compileHandler?: CompileElementFn;
}

class NodeRegistryClass {
  private defs       = new Map<string, NodeDef>();
  private components = new Map<string, React.ComponentType<any>>();
  private handlers   = new Map<string, CompileElementFn>();

  /**
   * Register a node type.
   *
   * - Without `opts.component` → a React component is auto-generated from
   *   the field + handle spec (sufficient for most nodes).
   * - With `opts.component` → the supplied component is used (for nodes
   *   that need custom rendering beyond what fields/handles can express).
   * - With `opts.compileHandler` → the handler is called per storey element
   *   during IFC compile.
   */
  register(def: NodeDef, opts?: RegisterOpts): void {
    this.defs.set(def.type, def);
    this.components.set(
      def.type,
      opts?.component ?? buildAutoComponent(def),
    );
    if (opts?.compileHandler) {
      this.handlers.set(def.type, opts.compileHandler);
    }
  }

  /** Returns the compile handler for a type, or undefined if not registered. */
  getCompileHandler(type: string): CompileElementFn | undefined {
    return this.handlers.get(type);
  }

  /**
   * Returns the ReactFlow nodeTypes map.
   * Call once at module level (after all registrations) for stable references.
   */
  getNodeTypes(): NodeTypes {
    const result: NodeTypes = {};
    for (const [type, comp] of this.components) result[type] = comp;
    return result;
  }

  /** Returns palette sidebar items in registration order. */
  getPaletteItems(): PaletteItem[] {
    return [...this.defs.values()].map(d => ({
      type:      d.type,
      label:     d.label,
      icon:      d.icon,
      iconColor: d.iconColor ?? 'text-muted-foreground',
      category:  d.category,
    }));
  }

  /**
   * Returns default data for each registered type.
   * Equivalent to the old DEFAULT_NODE_DATA constant — used by addNode().
   */
  getDefaultData(): Record<string, Record<string, unknown>> {
    const result: Record<string, Record<string, unknown>> = {};
    for (const def of this.defs.values()) {
      const data: Record<string, unknown> = {};
      for (const f of def.fields) data[f.id] = f.defaultValue;
      result[def.type] = data;
    }
    return result;
  }
}

export const NodeRegistry = new NodeRegistryClass();

// ─── Auto-component builder ────────────────────────────────────────────────

/**
 * Generates a React component from a NodeDef.
 * Supports text, number, textarea, and select field types.
 * Renders all declared handles automatically.
 */
function buildAutoComponent(
  def: NodeDef,
): React.ComponentType<NodeProps<Node<Record<string, unknown>>>> {
  function AutoNode({
    id,
    data,
    selected,
  }: NodeProps<Node<Record<string, unknown>>>) {
    const { updateNodeData } = useReactFlow();
    const upd = (patch: Record<string, unknown>) => updateNodeData(id, patch);

    return (
      <BaseNode
        title={def.label}
        subtitle={def.subtitle}
        headerClass={def.headerClass}
        selected={selected}
      >
        {def.fields.map(field => {
          const val = data[field.id] ?? field.defaultValue;
          return (
            <NodeField key={field.id} label={field.label}>
              {field.type === 'select' && field.options ? (
                <select
                  className="nodrag flex-1 h-6 px-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary w-full"
                  value={String(val)}
                  onChange={e => upd({ [field.id]: e.target.value })}
                >
                  {field.options.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea
                  className="nodrag flex-1 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary w-full resize-none"
                  rows={3}
                  value={String(val)}
                  placeholder={field.placeholder}
                  onChange={e => upd({ [field.id]: e.target.value })}
                />
              ) : (
                <NodeInput
                  type={field.type === 'number' ? 'number' : 'text'}
                  value={val as string | number}
                  onChange={v => upd({ [field.id]: v })}
                  placeholder={field.placeholder}
                  step={field.step}
                />
              )}
            </NodeField>
          );
        })}
        {def.handles.map((h, i) => (
          <Handle
            key={i}
            type={h.type}
            position={POS_MAP[h.position]}
            id={h.id}
            style={h.color ? { background: h.color } : undefined}
          />
        ))}
      </BaseNode>
    );
  }

  AutoNode.displayName = `AutoNode_${def.type}`;
  return AutoNode;
}
