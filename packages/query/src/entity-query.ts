/**
 * Fluent query builder for entities
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { IfcTypeEnum } from '@ifc-lite/data';
import { QueryResultEntity } from './query-result-entity.js';

export type ComparisonOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'startsWith';

export class EntityQuery {
  private store: IfcDataStore;
  private typeFilter: IfcTypeEnum[] | null;
  private idFilter: number[] | null;
  private propertyFilters: Array<{ pset: string; prop: string; op: ComparisonOperator; value: any }> = [];
  private limitCount: number | null = null;
  private offsetCount: number = 0;
  
  constructor(store: IfcDataStore, types: IfcTypeEnum[] | null, ids: number[] | null = null) {
    this.store = store;
    this.typeFilter = types;
    this.idFilter = ids;
  }

  // ═══════════════════════════════════════════════════════════════
  // FILTERING
  // ═══════════════════════════════════════════════════════════════
  
  whereProperty(psetName: string, propName: string, operator: ComparisonOperator, value: any): this {
    this.propertyFilters.push({ pset: psetName, prop: propName, op: operator, value });
    return this;
  }
  
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  // ═══════════════════════════════════════════════════════════════
  // EXECUTION
  // ═══════════════════════════════════════════════════════════════
  
  execute(): QueryResultEntity[] {
    let ids = this.getCandidateIds();
    ids = this.applyPropertyFilters(ids);
    
    if (this.offsetCount > 0) {
      ids = ids.slice(this.offsetCount);
    }
    if (this.limitCount !== null) {
      ids = ids.slice(0, this.limitCount);
    }
    
    return ids.map(id => new QueryResultEntity(this.store, id));
  }
  
  async ids(): Promise<number[]> {
    let ids = this.getCandidateIds();
    ids = this.applyPropertyFilters(ids);
    if (this.offsetCount > 0) ids = ids.slice(this.offsetCount);
    if (this.limitCount !== null) ids = ids.slice(0, this.limitCount);
    return ids;
  }
  
  async count(): Promise<number> {
    let ids = this.getCandidateIds();
    ids = this.applyPropertyFilters(ids);
    return ids.length;
  }
  
  async first(): Promise<QueryResultEntity | null> {
    const results = this.limit(1).execute();
    return results[0] ?? null;
  }

  // ═══════════════════════════════════════════════════════════════
  // PRIVATE
  // ═══════════════════════════════════════════════════════════════
  
  private getCandidateIds(): number[] {
    if (this.idFilter) return [...this.idFilter];
    if (this.typeFilter) {
      const ids: number[] = [];
      for (const typeEnum of this.typeFilter) {
        ids.push(...this.store.entities.getByType(typeEnum));
      }
      return ids;
    }
    // Return all entity IDs
    const allIds: number[] = [];
    for (let i = 0; i < this.store.entities.count; i++) {
      allIds.push(this.store.entities.expressId[i]);
    }
    return allIds;
  }
  
  private applyPropertyFilters(ids: number[]): number[] {
    if (this.propertyFilters.length === 0) return ids;
    
    let filteredIds = ids;
    
    for (const filter of this.propertyFilters) {
      const matchingIds = this.store.properties.findByProperty(filter.prop, filter.op, filter.value);
      const matchingSet = new Set(matchingIds);
      filteredIds = filteredIds.filter(id => matchingSet.has(id));
    }
    
    return filteredIds;
  }
}
