/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useGraph — React hook wrapping the node-registry compiler/decompiler.
 *
 * Provides code↔graph conversion with a lazily-initialized registry.
 */

import { useRef, useCallback } from 'react';
import {
  type Graph,
  type NodeDefinition,
  NodeRegistry,
  getRegistry,
  getBuiltinNodes,
  compileGraph,
  decompileScript,
} from '@ifc-lite/node-registry';

/** Lazily populate the global registry if not already done */
function ensureRegistryPopulated(registryRef: React.MutableRefObject<NodeRegistry | null>): NodeRegistry {
  if (registryRef.current) return registryRef.current;
  const registry = getRegistry();
  if (registry.getAll().length === 0) {
    registry.registerAll(getBuiltinNodes());
  }
  registryRef.current = registry;
  return registry;
}

export interface UseGraphResult {
  /** Decompile TypeScript code into a visual graph */
  codeToGraph: (code: string, name?: string) => {
    graph: Graph;
    unmappedLines: Array<{ line: number; text: string }>;
    warnings: string[];
  };
  /** Compile a visual graph into TypeScript code */
  graphToCode: (graph: Graph) => { code: string; warnings: string[] };
  /** Get all registered node definitions (for palette) */
  getNodes: () => NodeDefinition[];
  /** Get node definitions grouped by category */
  getCategories: () => Map<string, NodeDefinition[]>;
}

export function useGraph(): UseGraphResult {
  const registryRef = useRef<NodeRegistry | null>(null);

  const codeToGraph = useCallback((code: string, name?: string) => {
    const registry = ensureRegistryPopulated(registryRef);
    return decompileScript(code, registry, name);
  }, []);

  const graphToCode = useCallback((graph: Graph) => {
    const registry = ensureRegistryPopulated(registryRef);
    return compileGraph(graph, registry);
  }, []);

  const getNodes = useCallback(() => {
    const registry = ensureRegistryPopulated(registryRef);
    return registry.getAll();
  }, []);

  const getCategories = useCallback(() => {
    const registry = ensureRegistryPopulated(registryRef);
    const categories = new Map<string, NodeDefinition[]>();
    for (const node of registry.getAll()) {
      const cat = node.category;
      if (!categories.has(cat)) categories.set(cat, []);
      categories.get(cat)!.push(node);
    }
    return categories;
  }, []);

  return { codeToGraph, graphToCode, getNodes, getCategories };
}
