/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * GraphEditor — Manages graph state and wraps NodeCanvas.
 *
 * Graph state lives in the store (scriptGraph) so it survives unmount/remount.
 * Decompilation code→graph happens once on mode switch, not on every keystroke.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Graph, GraphEdge, GraphNode, NodeDefinition } from '@ifc-lite/node-registry';
import { useGraph } from '@/hooks/useGraph';
import { useViewerStore } from '@/store';
import { NodeCanvas } from './NodeCanvas';

export function GraphEditor() {
  const editorContent = useViewerStore((s) => s.scriptEditorContent);
  const setEditorContent = useViewerStore((s) => s.setScriptEditorContent);
  const graphMode = useViewerStore((s) => s.scriptGraphMode);
  const graph = useViewerStore((s) => s.scriptGraph);
  const setGraph = useViewerStore((s) => s.setScriptGraph);

  const { codeToGraph, graphToCode, getNodes } = useGraph();

  const [warnings, setWarnings] = useState<string[]>([]);
  const isInitRef = useRef(false);
  // Use ref to read current editorContent in effect without it being a dependency
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  // Build a definition map for NodeCanvas (stable since getNodes is stable)
  const nodeDefMap = useMemo(() => {
    const map = new Map<string, NodeDefinition>();
    for (const def of getNodes()) {
      map.set(def.id, def);
    }
    return map;
  }, [getNodes]);

  // Decompile code → graph ONLY when toggling into graph mode (not on content change)
  useEffect(() => {
    if (graphMode && !isInitRef.current) {
      const result = codeToGraph(editorContentRef.current, 'Script');
      setGraph(result.graph);
      setWarnings(result.warnings);
      isInitRef.current = true;
    }
    if (!graphMode) {
      isInitRef.current = false;
    }
  }, [graphMode, codeToGraph, setGraph]);

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
      setGraph(
        graph
          ? {
              ...graph,
              nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x, y } } : n)),
            }
          : null,
      );
    },
    [graph, setGraph],
  );

  const handleEdgeAdd = useCallback(
    (edge: GraphEdge) => {
      if (!graph) return;
      // Prevent duplicates
      const exists = graph.edges.some(
        (e) =>
          e.sourceNodeId === edge.sourceNodeId &&
          e.sourcePortId === edge.sourcePortId &&
          e.targetNodeId === edge.targetNodeId &&
          e.targetPortId === edge.targetPortId,
      );
      if (exists) return;
      const updated = { ...graph, edges: [...graph.edges, edge] };
      setGraph(updated);
      syncCodeFromGraph(updated);
    },
    [graph, setGraph, syncCodeFromGraph],
  );

  const handleEdgeRemove = useCallback(
    (sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string) => {
      if (!graph) return;
      const updated = {
        ...graph,
        edges: graph.edges.filter(
          (e) =>
            !(
              e.sourceNodeId === sourceNodeId &&
              e.sourcePortId === sourcePortId &&
              e.targetNodeId === targetNodeId &&
              e.targetPortId === targetPortId
            ),
        ),
      };
      setGraph(updated);
      syncCodeFromGraph(updated);
    },
    [graph, setGraph, syncCodeFromGraph],
  );

  const handleNodeRemove = useCallback(
    (nodeId: string) => {
      if (!graph) return;
      const updated = {
        ...graph,
        nodes: graph.nodes.filter((n) => n.id !== nodeId),
        edges: graph.edges.filter((e) => e.sourceNodeId !== nodeId && e.targetNodeId !== nodeId),
      };
      setGraph(updated);
      syncCodeFromGraph(updated);
    },
    [graph, setGraph, syncCodeFromGraph],
  );

  const handleNodeAdd = useCallback(
    (definitionId: string, x: number, y: number) => {
      if (!graph) return;
      const id = crypto.randomUUID();
      const newNode: GraphNode = {
        id,
        definitionId,
        params: {},
        position: { x, y },
      };
      const updated = { ...graph, nodes: [...graph.nodes, newNode] };
      setGraph(updated);
      syncCodeFromGraph(updated);
    },
    [graph, setGraph, syncCodeFromGraph],
  );

  const currentGraph = graph ?? { name: 'Script', description: '', nodes: [], edges: [] };

  return (
    <div className="h-full w-full relative bg-background">
      <NodeCanvas
        graph={currentGraph}
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
