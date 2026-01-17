/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Entity node for graph traversal
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { extractPropertiesOnDemand, extractQuantitiesOnDemand } from '@ifc-lite/parser';
import { RelationshipType } from '@ifc-lite/data';

export class EntityNode {
  private store: IfcDataStore;
  readonly expressId: number;
  
  constructor(store: IfcDataStore, expressId: number) {
    this.store = store;
    this.expressId = expressId;
  }
  
  get globalId(): string {
    return this.store.entities.getGlobalId(this.expressId);
  }
  
  get name(): string {
    return this.store.entities.getName(this.expressId);
  }
  
  get type(): string {
    return this.store.entities.getTypeName(this.expressId);
  }

  // Spatial containment
  contains(): EntityNode[] {
    return this.getRelated(RelationshipType.ContainsElements, 'forward');
  }
  
  containedIn(): EntityNode | null {
    const nodes = this.getRelated(RelationshipType.ContainsElements, 'inverse');
    return nodes[0] ?? null;
  }
  
  // Aggregation
  decomposes(): EntityNode[] {
    return this.getRelated(RelationshipType.Aggregates, 'forward');
  }
  
  decomposedBy(): EntityNode | null {
    const nodes = this.getRelated(RelationshipType.Aggregates, 'inverse');
    return nodes[0] ?? null;
  }
  
  // Types
  definingType(): EntityNode | null {
    const nodes = this.getRelated(RelationshipType.DefinesByType, 'forward');
    return nodes[0] ?? null;
  }
  
  instances(): EntityNode[] {
    return this.getRelated(RelationshipType.DefinesByType, 'inverse');
  }
  
  // Openings
  voids(): EntityNode[] {
    return this.getRelated(RelationshipType.VoidsElement, 'forward');
  }
  
  filledBy(): EntityNode[] {
    return this.getRelated(RelationshipType.FillsElement, 'inverse');
  }

  // Multi-hop traversal
  traverse(relType: RelationshipType, depth: number, direction: 'forward' | 'inverse' = 'forward'): EntityNode[] {
    const visited = new Set<number>();
    const result: EntityNode[] = [];
    
    const visit = (nodeId: number, currentDepth: number) => {
      if (currentDepth > depth || visited.has(nodeId)) return;
      visited.add(nodeId);
      if (nodeId !== this.expressId) {
        result.push(new EntityNode(this.store, nodeId));
      }
      
      const edges = direction === 'forward'
        ? this.store.relationships.forward.getEdges(nodeId, relType)
        : this.store.relationships.inverse.getEdges(nodeId, relType);
      for (const edge of edges) {
        visit(edge.target, currentDepth + 1);
      }
    };
    
    visit(this.expressId, 0);
    return result;
  }

  // Spatial shortcuts
  building(): EntityNode | null {
    let current: EntityNode | null = this;
    const visited = new Set<number>();
    
    while (current && !visited.has(current.expressId)) {
      visited.add(current.expressId);
      if (current.type === 'IfcBuilding') return current;
      current = current.containedIn() ?? current.decomposedBy();
    }
    return null;
  }
  
  storey(): EntityNode | null {
    let current: EntityNode | null = this;
    const visited = new Set<number>();
    
    while (current && !visited.has(current.expressId)) {
      visited.add(current.expressId);
      if (current.type === 'IfcBuildingStorey') return current;
      current = current.containedIn() ?? current.decomposedBy();
    }
    return null;
  }

  // Data access - uses on-demand extraction when available (preferred)
  properties(): Array<{ name: string; globalId?: string; properties: Array<{ name: string; type: number; value: any }> }> {
    // Use on-demand extraction if map is available (fast single-entity access)
    if (this.store.onDemandPropertyMap) {
      return extractPropertiesOnDemand(this.store, this.expressId);
    }
    // Fallback to pre-computed property table (server-parsed data, IFCX)
    return this.store.properties.getForEntity(this.expressId);
  }

  property(psetName: string, propName: string): ReturnType<typeof this.store.properties.getPropertyValue> {
    // For single property lookup, on-demand would be slower than table lookup
    // But if no table, extract on-demand and search
    if (this.store.onDemandPropertyMap && !this.store.properties.getForEntity(this.expressId).length) {
      const props = this.properties();
      const pset = props.find(p => p.name === psetName);
      const prop = pset?.properties.find(p => p.name === propName);
      return prop?.value ?? null;
    }
    return this.store.properties.getPropertyValue(this.expressId, psetName, propName);
  }

  quantities(): Array<{ name: string; quantities: Array<{ name: string; type: number; value: number }> }> {
    // Use on-demand extraction if map is available (fast single-entity access)
    if (this.store.onDemandQuantityMap) {
      return extractQuantitiesOnDemand(this.store, this.expressId);
    }
    // Fallback to pre-computed quantity table (server-parsed data, IFCX)
    return this.store.quantities.getForEntity(this.expressId);
  }

  quantity(qsetName: string, quantityName: string): number | null {
    // For single quantity lookup, use on-demand if no table data
    if (this.store.onDemandQuantityMap && !this.store.quantities.getForEntity(this.expressId).length) {
      const qsets = this.quantities();
      const qset = qsets.find(q => q.name === qsetName);
      const qty = qset?.quantities.find(q => q.name === quantityName);
      return qty?.value ?? null;
    }
    return this.store.quantities.getQuantityValue(this.expressId, qsetName, quantityName);
  }

  private getRelated(relType: RelationshipType, direction: 'forward' | 'inverse'): EntityNode[] {
    const targets = this.store.relationships.getRelated(this.expressId, relType, direction);
    return targets.map((id: number) => new EntityNode(this.store, id));
  }
}
