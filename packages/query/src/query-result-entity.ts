/**
 * Query result entity - lazy-loaded entity data
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { EntityNode } from './entity-node.js';

export class QueryResultEntity {
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
  
  get properties() {
    return this.store.properties.getForEntity(this.expressId);
  }
  
  getProperty(psetName: string, propName: string) {
    return this.store.properties.getPropertyValue(this.expressId, psetName, propName);
  }
  
  asNode(): EntityNode {
    return new EntityNode(this.store, this.expressId);
  }
  
  toJSON(): object {
    return {
      expressId: this.expressId,
      globalId: this.globalId,
      name: this.name,
      type: this.type,
      properties: this.properties,
    };
  }
}
