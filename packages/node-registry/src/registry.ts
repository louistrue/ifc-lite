/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * NodeRegistry — stores and retrieves node definitions.
 *
 * The registry is the single source of truth for what nodes exist.
 * ifc-flow reads from this to build its palette.
 * The compiler reads from this to generate code.
 * Third-party packages register custom nodes here.
 */

import type { NodeDefinition, NodeCategory } from './types.js';

export class NodeRegistry {
  private nodes = new Map<string, NodeDefinition>();

  /** Register a node definition */
  register(definition: NodeDefinition): void {
    if (this.nodes.has(definition.id)) {
      throw new Error(`Node '${definition.id}' is already registered`);
    }
    this.nodes.set(definition.id, definition);
  }

  /** Register multiple node definitions at once */
  registerAll(definitions: NodeDefinition[]): void {
    for (const def of definitions) {
      this.register(def);
    }
  }

  /** Get a node definition by ID */
  get(id: string): NodeDefinition | undefined {
    return this.nodes.get(id);
  }

  /** Get all registered nodes */
  getAll(): NodeDefinition[] {
    return [...this.nodes.values()];
  }

  /** Get nodes by category */
  getByCategory(category: NodeCategory): NodeDefinition[] {
    return this.getAll().filter(n => n.category === category);
  }

  /** Get all categories that have registered nodes */
  getCategories(): NodeCategory[] {
    const cats = new Set<NodeCategory>();
    for (const node of this.nodes.values()) {
      cats.add(node.category);
    }
    return [...cats];
  }

  /** Check if a node is registered */
  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Unregister a node (for plugins that are unloaded) */
  unregister(id: string): boolean {
    return this.nodes.delete(id);
  }

  /** Clear all registrations */
  clear(): void {
    this.nodes.clear();
  }
}

/** Global default registry */
let defaultRegistry: NodeRegistry | null = null;

/** Get the global node registry (lazily created) */
export function getRegistry(): NodeRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new NodeRegistry();
  }
  return defaultRegistry;
}
