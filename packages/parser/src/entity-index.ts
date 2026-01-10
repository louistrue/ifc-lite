/**
 * Entity index builder - creates fast lookup structures
 */

import type { EntityRef, EntityIndex } from './types.js';

export class EntityIndexBuilder {
  private byId: Map<number, EntityRef> = new Map();
  private byType: Map<string, number[]> = new Map();

  addEntity(ref: EntityRef): void {
    this.byId.set(ref.expressId, ref);

    // Add to type index
    let typeList = this.byType.get(ref.type);
    if (!typeList) {
      typeList = [];
      this.byType.set(ref.type, typeList);
    }
    typeList.push(ref.expressId);
  }

  build(): EntityIndex {
    return {
      byId: this.byId,
      byType: this.byType,
    };
  }
}
