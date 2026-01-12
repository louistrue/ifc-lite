/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Relationship graph - bidirectional graph using CSR format
 * Enables fast traversal in both directions
 */

import { RelationshipType } from './types.js';

export interface Edge {
  target: number;
  type: RelationshipType;
  relationshipId: number;
}

export interface RelationshipEdges {
  offsets: Map<number, number>;
  counts: Map<number, number>;
  edgeTargets: Uint32Array;
  edgeTypes: Uint16Array;
  edgeRelIds: Uint32Array;
  
  getEdges(entityId: number, type?: RelationshipType): Edge[];
  getTargets(entityId: number, type?: RelationshipType): number[];
  hasAnyEdges(entityId: number): boolean;
}

export interface RelationshipGraph {
  forward: RelationshipEdges;
  inverse: RelationshipEdges;
  
  getRelated(entityId: number, relType: RelationshipType, direction: 'forward' | 'inverse'): number[];
  hasRelationship(sourceId: number, targetId: number, relType?: RelationshipType): boolean;
  getRelationshipsBetween(sourceId: number, targetId: number): RelationshipInfo[];
}

export interface RelationshipInfo {
  relationshipId: number;
  type: RelationshipType;
  typeName: string;
}

export class RelationshipGraphBuilder {
  private edges: Array<{ source: number; target: number; type: RelationshipType; relId: number }> = [];
  
  addEdge(source: number, target: number, type: RelationshipType, relId: number): void {
    this.edges.push({ source, target, type, relId });
  }
  
  build(): RelationshipGraph {
    // Sort edges by source for forward CSR, by target for inverse CSR
    const forwardEdges = [...this.edges].sort((a, b) => a.source - b.source);
    const inverseEdges = [...this.edges].sort((a, b) => a.target - b.target);
    
    const forward = this.buildEdges(forwardEdges, 'source', 'target');
    const inverse = this.buildEdges(inverseEdges, 'target', 'source');
    
    return {
      forward,
      inverse,
      
      getRelated: (entityId, relType, direction) => {
        const edges = direction === 'forward' 
          ? forward.getEdges(entityId, relType)
          : inverse.getEdges(entityId, relType);
        return edges.map((e: Edge) => e.target);
      },
      
      hasRelationship: (sourceId, targetId, relType) => {
        const edges = forward.getEdges(sourceId, relType);
        return edges.some((e: Edge) => e.target === targetId);
      },
      
      getRelationshipsBetween: (sourceId, targetId) => {
        const edges = forward.getEdges(sourceId);
        return edges
          .filter((e: Edge) => e.target === targetId)
          .map((e: Edge) => ({
            relationshipId: e.relationshipId,
            type: e.type,
            typeName: RelationshipTypeToString(e.type),
          }));
      },
    };
  }
  
  private buildEdges(
    sortedEdges: typeof this.edges,
    keyField: 'source' | 'target',
    valueField: 'source' | 'target'
  ): RelationshipEdges {
    const offsets = new Map<number, number>();
    const counts = new Map<number, number>();
    
    const edgeTargets = new Uint32Array(sortedEdges.length);
    const edgeTypes = new Uint16Array(sortedEdges.length);
    const edgeRelIds = new Uint32Array(sortedEdges.length);
    
    let currentKey = -1;
    for (let i = 0; i < sortedEdges.length; i++) {
      const edge = sortedEdges[i];
      const key = edge[keyField];
      
      if (key !== currentKey) {
        offsets.set(key, i);
        currentKey = key;
      }
      counts.set(key, (counts.get(key) ?? 0) + 1);
      
      edgeTargets[i] = edge[valueField];
      edgeTypes[i] = edge.type;
      edgeRelIds[i] = edge.relId;
    }
    
    return {
      offsets,
      counts,
      edgeTargets,
      edgeTypes,
      edgeRelIds,
      
      getEdges(entityId: number, type?: RelationshipType): Edge[] {
        const offset = offsets.get(entityId);
        if (offset === undefined) return [];
        
        const count = counts.get(entityId)!;
        const edges: Edge[] = [];
        
        for (let i = offset; i < offset + count; i++) {
          if (type === undefined || edgeTypes[i] === type) {
            edges.push({
              target: edgeTargets[i],
              type: edgeTypes[i],
              relationshipId: edgeRelIds[i],
            });
          }
        }
        
        return edges;
      },
      
      getTargets(entityId: number, type?: RelationshipType): number[] {
        return this.getEdges(entityId, type).map(e => e.target);
      },
      
      hasAnyEdges(entityId: number): boolean {
        return offsets.has(entityId);
      },
    };
  }
}

function RelationshipTypeToString(type: RelationshipType): string {
  const names: Record<RelationshipType, string> = {
    [RelationshipType.ContainsElements]: 'IfcRelContainedInSpatialStructure',
    [RelationshipType.Aggregates]: 'IfcRelAggregates',
    [RelationshipType.DefinesByProperties]: 'IfcRelDefinesByProperties',
    [RelationshipType.DefinesByType]: 'IfcRelDefinesByType',
    [RelationshipType.AssociatesMaterial]: 'IfcRelAssociatesMaterial',
    [RelationshipType.AssociatesClassification]: 'IfcRelAssociatesClassification',
    [RelationshipType.VoidsElement]: 'IfcRelVoidsElement',
    [RelationshipType.FillsElement]: 'IfcRelFillsElement',
    [RelationshipType.ConnectsPathElements]: 'IfcRelConnectsPathElements',
    [RelationshipType.ConnectsElements]: 'IfcRelConnectsElements',
    [RelationshipType.SpaceBoundary]: 'IfcRelSpaceBoundary',
    [RelationshipType.AssignsToGroup]: 'IfcRelAssignsToGroup',
    [RelationshipType.AssignsToProduct]: 'IfcRelAssignsToProduct',
    [RelationshipType.ReferencedInSpatialStructure]: 'ReferencedInSpatialStructure',
  };
  return names[type] || 'Unknown';
}
