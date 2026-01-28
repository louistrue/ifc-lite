/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Change set management for IFC mutations
 */

import type { ChangeSet, Mutation } from './types.js';
import { generateChangeSetId } from './types.js';

/**
 * Manages collections of mutations as named change sets
 */
export class ChangeSetManager {
  private changeSets: Map<string, ChangeSet> = new Map();
  private activeChangeSetId: string | null = null;

  /**
   * Create a new change set
   */
  createChangeSet(name: string): ChangeSet {
    const changeSet: ChangeSet = {
      id: generateChangeSetId(),
      name,
      createdAt: Date.now(),
      mutations: [],
      applied: false,
    };

    this.changeSets.set(changeSet.id, changeSet);
    this.activeChangeSetId = changeSet.id;

    return changeSet;
  }

  /**
   * Get the active change set
   */
  getActiveChangeSet(): ChangeSet | null {
    if (!this.activeChangeSetId) return null;
    return this.changeSets.get(this.activeChangeSetId) || null;
  }

  /**
   * Set the active change set
   */
  setActiveChangeSet(id: string | null): void {
    if (id && !this.changeSets.has(id)) {
      throw new Error(`Change set ${id} not found`);
    }
    this.activeChangeSetId = id;
  }

  /**
   * Add a mutation to the active change set
   */
  addMutation(mutation: Mutation): void {
    const changeSet = this.getActiveChangeSet();
    if (!changeSet) {
      // Auto-create a default change set
      const newChangeSet = this.createChangeSet('Unsaved Changes');
      newChangeSet.mutations.push(mutation);
    } else {
      changeSet.mutations.push(mutation);
    }
  }

  /**
   * Get a change set by ID
   */
  getChangeSet(id: string): ChangeSet | null {
    return this.changeSets.get(id) || null;
  }

  /**
   * Get all change sets
   */
  getAllChangeSets(): ChangeSet[] {
    return Array.from(this.changeSets.values());
  }

  /**
   * Delete a change set
   */
  deleteChangeSet(id: string): boolean {
    if (this.activeChangeSetId === id) {
      this.activeChangeSetId = null;
    }
    return this.changeSets.delete(id);
  }

  /**
   * Rename a change set
   */
  renameChangeSet(id: string, newName: string): void {
    const changeSet = this.changeSets.get(id);
    if (changeSet) {
      changeSet.name = newName;
    }
  }

  /**
   * Mark a change set as applied
   */
  markApplied(id: string): void {
    const changeSet = this.changeSets.get(id);
    if (changeSet) {
      changeSet.applied = true;
    }
  }

  /**
   * Merge multiple change sets into one
   */
  mergeChangeSets(ids: string[], newName: string): ChangeSet {
    const mutations: Mutation[] = [];

    for (const id of ids) {
      const changeSet = this.changeSets.get(id);
      if (changeSet) {
        mutations.push(...changeSet.mutations);
      }
    }

    // Sort by timestamp
    mutations.sort((a, b) => a.timestamp - b.timestamp);

    const merged: ChangeSet = {
      id: generateChangeSetId(),
      name: newName,
      createdAt: Date.now(),
      mutations,
      applied: false,
    };

    this.changeSets.set(merged.id, merged);
    return merged;
  }

  /**
   * Export a change set as JSON
   */
  exportChangeSet(id: string): string {
    const changeSet = this.changeSets.get(id);
    if (!changeSet) {
      throw new Error(`Change set ${id} not found`);
    }

    return JSON.stringify({
      version: 1,
      changeSet,
      exportedAt: Date.now(),
    }, null, 2);
  }

  /**
   * Import a change set from JSON
   */
  importChangeSet(json: string): ChangeSet {
    const data = JSON.parse(json);

    if (!data.changeSet) {
      throw new Error('Invalid change set format');
    }

    const changeSet: ChangeSet = {
      ...data.changeSet,
      id: generateChangeSetId(), // Generate new ID to avoid conflicts
      applied: false,
    };

    this.changeSets.set(changeSet.id, changeSet);
    return changeSet;
  }

  /**
   * Get statistics about all change sets
   */
  getStatistics(): {
    totalChangeSets: number;
    totalMutations: number;
    affectedEntities: number;
    affectedModels: number;
  } {
    const entities = new Set<string>();
    const models = new Set<string>();
    let totalMutations = 0;

    for (const changeSet of this.changeSets.values()) {
      totalMutations += changeSet.mutations.length;
      for (const mutation of changeSet.mutations) {
        entities.add(`${mutation.modelId}:${mutation.entityId}`);
        models.add(mutation.modelId);
      }
    }

    return {
      totalChangeSets: this.changeSets.size,
      totalMutations,
      affectedEntities: entities.size,
      affectedModels: models.size,
    };
  }

  /**
   * Clear all change sets
   */
  clear(): void {
    this.changeSets.clear();
    this.activeChangeSetId = null;
  }
}
