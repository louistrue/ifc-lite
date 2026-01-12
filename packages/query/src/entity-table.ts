/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Entity table - fast entity lookup and filtering
 */

import type { IfcEntity, EntityIndex } from '@ifc-lite/parser';

export class EntityTable {
  private entities: Map<number, IfcEntity>;
  private index: EntityIndex;

  constructor(entities: Map<number, IfcEntity>, index: EntityIndex) {
    this.entities = entities;
    this.index = index;
  }

  /**
   * Get entity by ID
   */
  getEntity(id: number): IfcEntity | null {
    return this.entities.get(id) || null;
  }

  /**
   * Get entities by type
   */
  getEntitiesByType(type: string): IfcEntity[] {
    const ids = this.index.byType.get(type) || [];
    return ids.map(id => this.entities.get(id)).filter((e): e is IfcEntity => e !== undefined);
  }

  /**
   * Check if entity exists
   */
  hasEntity(id: number): boolean {
    return this.entities.has(id);
  }

  /**
   * Get all entities
   */
  getAllEntities(): IfcEntity[] {
    return Array.from(this.entities.values());
  }
}
