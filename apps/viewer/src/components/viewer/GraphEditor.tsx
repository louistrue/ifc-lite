/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * GraphEditor — Manages graph state and wraps NodeCanvas.
 *
 * Maintains a local graph state derived from the editor code,
 * and syncs changes back to code via the compiler.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Graph, GraphNode, GraphEdge, NodeDefinition } from '@ifc-lite/node-registry';
import { useGraph } from '@/hooks/useGraph';
import { useViewerStore } from '@/store';
import { NodeCanvas } from './NodeCanvas';

export function GraphEditor() {
  const editorContent = useViewerStore((s) => s.scriptEditorContent);
  const setEditorContent = useViewerStore((s) => s.setScriptEditorContent);
  const graphMode = useViewerStore((s) => s.scriptGraphMode);

  const { codeToGraph, graphToCode, getNodes } = useGraph();

  // Local graph state — decompiled from code on mount/mode switch
  const [graph, setGraph] = useState<Graph>({ name: 'Script', description: '', nodes: [], edges: [] });
  const [warnings, setWarnings] = useState<string[]>([]);
  const isInitRef = useRef(false);

  // Build a definition map for NodeCanvas
  const nodeDefMap = useMemo(() => {
    const map = new Map<string, NodeDefinition>();
    for (const def of getNodes()) {
      map.set(def.id, def);
    }
    return map;
  }, [getNodes]);

  // Decompile code → graph when switching to graph mode
  useEffect(() => {
    if (graphMode && !isInitRef.current) {
      const result = codeToGraph(editorContent, 'Script');
      setGraph(result.graph);
      setWarnings(result.warnings);
      isInitRef.current = true;
    }
    if (!graphMode) {
      isInitRef.current = false;
    }
  }, [graphMode, editorContent, codeToGraph]);

  /** Compile graph → code and update the store */
  const syncCodeFromGraph = useCallback(
    (updatedGraph: Graph) => {
      const result = graphToCode(updatedGraph);
      setEditorContent(result.code);
      if (result.warnings.length > 0) {
        setWarnings(result.warnings);
      }
    },
    [graphToCode, setEditorContent],
  );

  // ── Graph mutation callbacks ──

  const handleNodeMove = useCallback(
    (nodeId: string, x: number, y: number) => {
      setGraph((prev) => {
        const updated = {
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x, y } } : n)),
        };
        // Don't recompile on every drag frame — just update position
        return updated;
      });
    },
    [],
  );

  const handleNodeMoveEnd = useCallback(() => {
    // Recompile after drag ends (positions don't affect code, but keep in sync)
  }, []);

  const handleEdgeAdd = useCallback(
    (edge: GraphEdge) => {
      setGraph((prev) => {
        // Prevent duplicates
        const exists = prev.edges.some(
          (e) =>
            e.sourceNodeId === edge.sourceNodeId &&
            e.sourcePortId === edge.sourcePortId &&
            e.targetNodeId === edge.targetNodeId &&
            e.targetPortId === edge.targetPortId,
        );
        if (exists) return prev;
        const updated = { ...prev, edges: [...prev.edges, edge] };
        syncCodeFromGraph(updated);
        return updated;
      });
    },
    [syncCodeFromGraph],
  );

  const handleEdgeRemove = useCallback(
    (sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string) => {
      setGraph((prev) => {
        const updated = {
          ...prev,
          edges: prev.edges.filter(
            (e) =>
              !(
                e.sourceNodeId === sourceNodeId &&
                e.sourcePortId === sourcePortId &&
                e.targetNodeId === targetNodeId &&
                e.targetPortId === targetPortId
              ),
          ),
        };
        syncCodeFromGraph(updated);
        return updated;
      });
    },
    [syncCodeFromGraph],
  );

  const handleNodeRemove = useCallback(
    (nodeId: string) => {
      setGraph((prev) => {
        const updated = {
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== nodeId),
          edges: prev.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
        };
        syncCodeFromGraph(updated);
        return updated;
      });
    },
    [syncCodeFromGraph],
  );

  const handleNodeAdd = useCallback(
    (definitionId: string, x: number, y: number) => {
      const id = `node_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newNode: GraphNode = {
        id,
        definitionId,
        params: {},
        position: { x, y },
      };
      setGraph((prev) => {
        const updated = { ...prev, nodes: [...prev.nodes, newNode] };
        syncCodeFromGraph(updated);
        return updated;
      });
    },
    [syncCodeFromGraph],
  );

  return (
    <div className="h-full w-full relative bg-background">
      <NodeCanvas
        graph={graph}
        nodeDefinitions={nodeDefMap}
        onNodeMove={handleNodeMove}
        onEdgeAdd={handleEdgeAdd}
        onEdgeRemove={handleEdgeRemove}
        onNodeRemove={handleNodeRemove}
        onNodeAdd={handleNodeAdd}
      />
      {/* Warnings overlay */}
      {warnings.length > 0 && (
        <div className="absolute bottom-2 left-2 right-2 bg-yellow-900/80 text-yellow-200 text-xs px-2 py-1 rounded">
          {warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
