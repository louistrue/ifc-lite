/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Mutable property view - overlay pattern for property mutations
 *
 * This class provides a mutable view over an immutable PropertyTable.
 * Changes are tracked separately and applied on-the-fly during reads.
 *
 * Supports both pre-built property tables and on-demand property extraction
 * for optimal performance with large models.
 */

import type { PropertyTable, PropertySet, Property } from '@ifc-lite/data';
import { PropertyValueType } from '@ifc-lite/data';
import type { PropertyValue, PropertyMutation, Mutation } from './types.js';
import { propertyKey, generateMutationId } from './types.js';

/**
 * Function type for on-demand property extraction
 * Allows globalId to be optional to match extractPropertiesOnDemand return type
 */
export type PropertyExtractor = (entityId: number) => Array<{
  name: string;
  globalId?: string;
  properties: Array<{ name: string; type: number; value: unknown }>;
}>;

export class MutablePropertyView {
  private baseTable: PropertyTable | null;
  private onDemandExtractor: PropertyExtractor | null = null;
  private propertyMutations: Map<string, PropertyMutation> = new Map();
  private deletedPsets: Set<string> = new Set(); // `${entityId}:${psetName}`
  private newPsets: Map<number, Map<string, PropertySet>> = new Map(); // entityId -> psetName -> PropertySet
  private mutationHistory: Mutation[] = [];
  private modelId: string;

  constructor(baseTable: PropertyTable | null, modelId: string) {
    this.baseTable = baseTable;
    this.modelId = modelId;
  }

  /**
   * Set an on-demand property extractor function
   * This is used when properties are extracted lazily from the source buffer
   */
  setOnDemandExtractor(extractor: PropertyExtractor): void {
    this.onDemandExtractor = extractor;
  }

  /**
   * Get base properties for an entity (before mutations)
   * Uses on-demand extraction if available, otherwise falls back to base table
   */
  private getBasePropertiesForEntity(entityId: number): PropertySet[] {
    // Prefer on-demand extraction if available (client-side WASM parsing)
    if (this.onDemandExtractor) {
      // Normalize the result to PropertySet[] (globalId defaults to empty string)
      return this.onDemandExtractor(entityId).map(pset => ({
        name: pset.name,
        globalId: pset.globalId || '',
        properties: pset.properties.map(prop => ({
          name: prop.name,
          type: prop.type as PropertyValueType,
          value: prop.value as PropertyValue,
        })),
      }));
    }
    // Fallback to pre-built property table
    if (this.baseTable) {
      return this.baseTable.getForEntity(entityId);
    }
    return [];
  }

  /**
   * Get all property sets for an entity, with mutations applied
   */
  getForEntity(entityId: number): PropertySet[] {
    const result: PropertySet[] = [];
    const seenPsets = new Set<string>();

    // First, add properties from base (on-demand or table) with mutations applied
    const basePsets = this.getBasePropertiesForEntity(entityId);

    for (const pset of basePsets) {
      // Skip deleted property sets
      if (this.deletedPsets.has(`${entityId}:${pset.name}`)) {
        continue;
      }

      seenPsets.add(pset.name);

      // Apply property mutations
      const mutatedProperties: Property[] = [];
      for (const prop of pset.properties) {
        const key = propertyKey(entityId, pset.name, prop.name);
        const mutation = this.propertyMutations.get(key);

        if (mutation) {
          if (mutation.operation === 'DELETE') {
            continue; // Skip deleted properties
          }
          // Apply SET mutation
          mutatedProperties.push({
            name: prop.name,
            type: mutation.valueType ?? prop.type,
            value: mutation.value ?? null,
            unit: mutation.unit ?? prop.unit,
          });
        } else {
          mutatedProperties.push(prop);
        }
      }

      // Check for new properties added to this pset
      for (const [key, mutation] of this.propertyMutations) {
        if (key.startsWith(`${entityId}:${pset.name}:`) && mutation.operation === 'SET') {
          const propName = key.split(':')[2];
          // Only add if not already in the list
          if (!mutatedProperties.some(p => p.name === propName)) {
            mutatedProperties.push({
              name: propName,
              type: mutation.valueType ?? PropertyValueType.String,
              value: mutation.value ?? null,
              unit: mutation.unit,
            });
          }
        }
      }

      if (mutatedProperties.length > 0) {
        result.push({
          name: pset.name,
          globalId: pset.globalId,
          properties: mutatedProperties,
        });
      }
    }

    // Add new property sets that don't exist in base
    const newPsetsForEntity = this.newPsets.get(entityId);
    if (newPsetsForEntity) {
      for (const [psetName, pset] of newPsetsForEntity) {
        if (!seenPsets.has(psetName)) {
          result.push(pset);
        }
      }
    }

    return result;
  }

  /**
   * Get a specific property value with mutations applied
   */
  getPropertyValue(
    entityId: number,
    psetName: string,
    propName: string
  ): PropertyValue | null {
    const key = propertyKey(entityId, psetName, propName);
    const mutation = this.propertyMutations.get(key);

    if (mutation) {
      if (mutation.operation === 'DELETE') {
        return null;
      }
      return mutation.value ?? null;
    }

    // Check new property sets
    const newPset = this.newPsets.get(entityId)?.get(psetName);
    if (newPset) {
      const prop = newPset.properties.find(p => p.name === propName);
      if (prop) {
        return prop.value;
      }
    }

    // Fall back to on-demand extraction or base table
    const basePsets = this.getBasePropertiesForEntity(entityId);
    const pset = basePsets.find(p => p.name === psetName);
    if (pset) {
      const prop = pset.properties.find(p => p.name === propName);
      if (prop) {
        return prop.value;
      }
    }

    return null;
  }

  /**
   * Set a property value
   * If the property set doesn't exist, creates it automatically
   * @param skipHistory - If true, don't add to mutation history (used for undo/redo)
   */
  setProperty(
    entityId: number,
    psetName: string,
    propName: string,
    value: PropertyValue,
    valueType: PropertyValueType = PropertyValueType.String,
    unit?: string,
    skipHistory: boolean = false
  ): Mutation {
    const key = propertyKey(entityId, psetName, propName);
    console.log('[MutablePropertyView.setProperty] entityId:', entityId, 'pset:', psetName, 'prop:', propName, 'value:', value, 'key:', key);

    // Get old value for undo
    const oldValue = this.getPropertyValue(entityId, psetName, propName);
    console.log('[MutablePropertyView.setProperty] oldValue:', oldValue);

    // Check if this pset exists in base
    const basePsets = this.getBasePropertiesForEntity(entityId);
    const psetExistsInBase = basePsets.some(p => p.name === psetName);
    const psetExistsInNew = this.newPsets.get(entityId)?.has(psetName);

    // If pset doesn't exist anywhere, create it in newPsets
    if (!psetExistsInBase && !psetExistsInNew) {
      let entityPsets = this.newPsets.get(entityId);
      if (!entityPsets) {
        entityPsets = new Map();
        this.newPsets.set(entityId, entityPsets);
      }
      // Create new property set with this single property
      const pset: PropertySet = {
        name: psetName,
        globalId: `new_${generateMutationId()}`,
        properties: [{
          name: propName,
          type: valueType,
          value: value,
          unit: unit,
        }],
      };
      entityPsets.set(psetName, pset);
    } else if (psetExistsInNew) {
      // If pset exists in newPsets, add/update the property there
      const entityPsets = this.newPsets.get(entityId)!;
      const pset = entityPsets.get(psetName)!;
      const existingPropIndex = pset.properties.findIndex(p => p.name === propName);
      if (existingPropIndex >= 0) {
        pset.properties[existingPropIndex] = {
          name: propName,
          type: valueType,
          value: value,
          unit: unit,
        };
      } else {
        pset.properties.push({
          name: propName,
          type: valueType,
          value: value,
          unit: unit,
        });
      }
    }

    // Always store in propertyMutations for tracking
    this.propertyMutations.set(key, {
      operation: 'SET',
      value,
      valueType,
      unit,
    });

    const mutation: Mutation = {
      id: generateMutationId(),
      type: oldValue === null ? 'CREATE_PROPERTY' : 'UPDATE_PROPERTY',
      timestamp: Date.now(),
      modelId: this.modelId,
      entityId,
      psetName,
      propName,
      oldValue,
      newValue: value,
      valueType,
    };

    if (!skipHistory) {
      this.mutationHistory.push(mutation);
    }
    return mutation;
  }

  /**
   * Delete a property
   * @param skipHistory - If true, don't add to mutation history (used for undo/redo)
   */
  deleteProperty(entityId: number, psetName: string, propName: string, skipHistory: boolean = false): Mutation | null {
    const key = propertyKey(entityId, psetName, propName);
    const oldValue = this.getPropertyValue(entityId, psetName, propName);

    if (oldValue === null) {
      return null; // Property doesn't exist
    }

    this.propertyMutations.set(key, { operation: 'DELETE' });

    const mutation: Mutation = {
      id: generateMutationId(),
      type: 'DELETE_PROPERTY',
      timestamp: Date.now(),
      modelId: this.modelId,
      entityId,
      psetName,
      propName,
      oldValue,
      newValue: null,
    };

    if (!skipHistory) {
      this.mutationHistory.push(mutation);
    }
    return mutation;
  }

  /**
   * Create a new property set
   */
  createPropertySet(
    entityId: number,
    psetName: string,
    properties: Array<{ name: string; value: PropertyValue; type?: PropertyValueType; unit?: string }>
  ): Mutation {
    let entityPsets = this.newPsets.get(entityId);
    if (!entityPsets) {
      entityPsets = new Map();
      this.newPsets.set(entityId, entityPsets);
    }

    const pset: PropertySet = {
      name: psetName,
      globalId: `new_${generateMutationId()}`,
      properties: properties.map(p => ({
        name: p.name,
        type: p.type ?? PropertyValueType.String,
        value: p.value,
        unit: p.unit,
      })),
    };

    entityPsets.set(psetName, pset);

    // Also add individual property mutations for consistency
    for (const prop of properties) {
      const key = propertyKey(entityId, psetName, prop.name);
      this.propertyMutations.set(key, {
        operation: 'SET',
        value: prop.value,
        valueType: prop.type ?? PropertyValueType.String,
        unit: prop.unit,
      });
    }

    const mutation: Mutation = {
      id: generateMutationId(),
      type: 'CREATE_PROPERTY_SET',
      timestamp: Date.now(),
      modelId: this.modelId,
      entityId,
      psetName,
      newValue: properties as unknown as PropertyValue,
    };

    this.mutationHistory.push(mutation);
    return mutation;
  }

  /**
   * Delete an entire property set
   */
  deletePropertySet(entityId: number, psetName: string): Mutation {
    this.deletedPsets.add(`${entityId}:${psetName}`);

    // Also remove from new psets if it was created in this session
    const entityPsets = this.newPsets.get(entityId);
    if (entityPsets) {
      entityPsets.delete(psetName);
    }

    // Mark all properties as deleted
    const existingPsets = this.getBasePropertiesForEntity(entityId);
    const pset = existingPsets.find(p => p.name === psetName);
    if (pset) {
      for (const prop of pset.properties) {
        const key = propertyKey(entityId, psetName, prop.name);
        this.propertyMutations.set(key, { operation: 'DELETE' });
      }
    }

    const mutation: Mutation = {
      id: generateMutationId(),
      type: 'DELETE_PROPERTY_SET',
      timestamp: Date.now(),
      modelId: this.modelId,
      entityId,
      psetName,
    };

    this.mutationHistory.push(mutation);
    return mutation;
  }

  /**
   * Get all mutations applied to this view
   */
  getMutations(): Mutation[] {
    return [...this.mutationHistory];
  }

  /**
   * Get mutations for a specific entity
   */
  getMutationsForEntity(entityId: number): Mutation[] {
    return this.mutationHistory.filter(m => m.entityId === entityId);
  }

  /**
   * Check if an entity has any mutations
   */
  hasChanges(entityId?: number): boolean {
    if (entityId !== undefined) {
      return this.mutationHistory.some(m => m.entityId === entityId);
    }
    return this.mutationHistory.length > 0;
  }

  /**
   * Get count of modified entities
   */
  getModifiedEntityCount(): number {
    const entities = new Set<number>();
    for (const mutation of this.mutationHistory) {
      entities.add(mutation.entityId);
    }
    return entities.size;
  }

  /**
   * Clear all mutations (reset to base state)
   */
  clear(): void {
    this.propertyMutations.clear();
    this.deletedPsets.clear();
    this.newPsets.clear();
    this.mutationHistory = [];
  }

  /**
   * Apply a batch of mutations (e.g., from imported change set)
   */
  applyMutations(mutations: Mutation[]): void {
    for (const mutation of mutations) {
      switch (mutation.type) {
        case 'CREATE_PROPERTY':
        case 'UPDATE_PROPERTY':
          if (mutation.psetName && mutation.propName && mutation.newValue !== undefined) {
            this.setProperty(
              mutation.entityId,
              mutation.psetName,
              mutation.propName,
              mutation.newValue,
              mutation.valueType
            );
          }
          break;

        case 'DELETE_PROPERTY':
          if (mutation.psetName && mutation.propName) {
            this.deleteProperty(mutation.entityId, mutation.psetName, mutation.propName);
          }
          break;

        case 'DELETE_PROPERTY_SET':
          if (mutation.psetName) {
            this.deletePropertySet(mutation.entityId, mutation.psetName);
          }
          break;
      }
    }
  }

  /**
   * Export mutations as JSON
   */
  exportMutations(): string {
    return JSON.stringify({
      modelId: this.modelId,
      mutations: this.mutationHistory,
      exportedAt: Date.now(),
    }, null, 2);
  }

  /**
   * Import mutations from JSON
   */
  importMutations(json: string): void {
    const data = JSON.parse(json);
    if (data.mutations && Array.isArray(data.mutations)) {
      this.applyMutations(data.mutations);
    }
  }
}
