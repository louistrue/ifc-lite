/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Merged IFC STEP exporter
 *
 * Combines multiple IFC models into a single STEP file, similar to
 * IfcOpenShell's MergeProjects recipe. Handles ID remapping, spatial
 * structure unification, and infrastructure deduplication.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { generateHeader } from '@ifc-lite/parser';
import { collectReferencedEntityIds, getVisibleEntityIds } from './reference-collector.js';

/** Regex to match #ID references in STEP entity text. */
const STEP_REF_REGEX = /#(\d+)/g;

/** Entity types forming the spatial project root (deduplicated across models). */
const PROJECT_ROOT_TYPES = new Set([
  'IFCPROJECT',
]);

/** Entity types forming shared infrastructure (deduplicated across models). */
const SHARED_INFRASTRUCTURE_TYPES = new Set([
  'IFCUNITASSIGNMENT',
  'IFCGEOMETRICREPRESENTATIONCONTEXT',
  'IFCGEOMETRICREPRESENTATIONSUBCONTEXT',
]);

/**
 * A model to be included in the merge, with its data store and metadata.
 */
export interface MergeModelInput {
  /** Unique model identifier */
  id: string;
  /** Display name */
  name: string;
  /** Parsed IFC data store (must have source buffer) */
  dataStore: IfcDataStore;
}

/**
 * Options for merged STEP export
 */
export interface MergeExportOptions {
  /** IFC schema version for the output file */
  schema: 'IFC2X3' | 'IFC4' | 'IFC4X3';
  /** File description */
  description?: string;
  /** Author name */
  author?: string;
  /** Organization name */
  organization?: string;
  /** Application name (defaults to 'ifc-lite') */
  application?: string;
  /** Output filename */
  filename?: string;

  /**
   * Strategy for merging the project hierarchy:
   * - 'keep-first': Keep the first model's IfcProject as the root
   * - 'create-new': Generate a new IfcProject wrapping all models
   */
  projectStrategy: 'keep-first' | 'create-new';

  /** Apply visibility filtering to each model before merging */
  visibleOnly?: boolean;
  /** Hidden entity IDs per model (local expressIds) */
  hiddenEntityIdsByModel?: Map<string, Set<number>>;
  /** Isolated entity IDs per model (null = no isolation) */
  isolatedEntityIdsByModel?: Map<string, Set<number> | null>;
}

/**
 * Result of merged STEP export
 */
export interface MergeExportResult {
  /** STEP file content */
  content: string;
  /** Statistics */
  stats: {
    /** Number of models merged */
    modelCount: number;
    /** Total entities in the output */
    totalEntityCount: number;
    /** File size in bytes */
    fileSize: number;
  };
}

/**
 * Merges multiple IFC models into a single STEP file.
 *
 * Algorithm:
 * 1. First model's entities use their original IDs
 * 2. Subsequent models' IDs are offset to avoid collisions
 * 3. Shared infrastructure (units, contexts) from subsequent models
 *    is deduplicated — references point to first model's versions
 * 4. IfcProject from subsequent models is skipped; their buildings
 *    are linked to the first model's site via IfcRelAggregates
 */
export class MergedExporter {
  private models: MergeModelInput[];

  constructor(models: MergeModelInput[]) {
    if (models.length === 0) {
      throw new Error('MergedExporter requires at least one model');
    }
    this.models = models;
  }

  export(options: MergeExportOptions): MergeExportResult {
    const schema = options.schema || 'IFC4';

    // Generate header
    const header = generateHeader({
      schema,
      description: options.description || `Merged export of ${this.models.length} models from ifc-lite`,
      author: options.author || '',
      organization: options.organization || '',
      application: options.application || 'ifc-lite',
      filename: options.filename || 'merged.ifc',
    });

    const allEntityLines: string[] = [];
    const decoder = new TextDecoder();

    // Track ID offsets per model
    let nextAvailableId = 1;
    const modelOffsets = new Map<string, number>();

    // First pass: determine ID offsets
    for (const model of this.models) {
      modelOffsets.set(model.id, nextAvailableId - 1); // offset = nextAvailableId - 1 so IDs start at nextAvailableId
      let maxId = 0;
      for (const [id] of model.dataStore.entityIndex.byId) {
        if (id > maxId) maxId = id;
      }
      nextAvailableId += maxId;
    }

    // Collect first model's shared infrastructure IDs for deduplication
    const firstModel = this.models[0];
    const firstModelInfraMap = this.findInfrastructureEntities(firstModel.dataStore);

    // Track IDs of IfcSite in first model for attaching other models' buildings
    const firstModelSiteIds = this.findEntitiesByType(firstModel.dataStore, 'IFCSITE');

    // Process each model
    let isFirstModel = true;

    for (const model of this.models) {
      const offset = modelOffsets.get(model.id)!;
      const source = model.dataStore.source;
      if (!source || source.length === 0) continue;

      // Determine which entities to include
      let includedEntityIds: Set<number> | null = null;

      if (options.visibleOnly) {
        const hiddenIds = options.hiddenEntityIdsByModel?.get(model.id) ?? new Set<number>();
        const isolatedIds = options.isolatedEntityIdsByModel?.get(model.id) ?? null;
        const visibleRoots = getVisibleEntityIds(model.dataStore, hiddenIds, isolatedIds);
        includedEntityIds = collectReferencedEntityIds(
          visibleRoots,
          source,
          model.dataStore.entityIndex.byId,
        );
      }

      // Build remap table for this model's shared entities → first model's equivalents
      const sharedRemap = new Map<number, number>();

      if (!isFirstModel) {
        // Map this model's shared infrastructure to first model's versions
        const modelInfra = this.findInfrastructureEntities(model.dataStore);
        for (const [type, firstModelIds] of firstModelInfraMap) {
          const thisModelIds = modelInfra.get(type);
          if (thisModelIds && firstModelIds.length > 0 && thisModelIds.length > 0) {
            // Map first matching entity of this type to first model's version
            // Apply the offset to the first model's ID since first model has offset 0
            const firstModelOffset = modelOffsets.get(firstModel.id)!;
            sharedRemap.set(thisModelIds[0], firstModelIds[0] + firstModelOffset);
          }
        }

        // Skip IfcProject from subsequent models
        const projectIds = this.findEntitiesByType(model.dataStore, 'IFCPROJECT');
        for (const pid of projectIds) {
          sharedRemap.set(pid, -1); // -1 means "skip this entity"
        }
      }

      // Emit entities for this model
      for (const [expressId, entityRef] of model.dataStore.entityIndex.byId) {
        // Skip entities outside the visible closure
        if (includedEntityIds !== null && !includedEntityIds.has(expressId)) {
          continue;
        }

        // Skip entities that are being deduplicated (mapped to -1 = skip)
        if (sharedRemap.get(expressId) === -1) {
          continue;
        }

        // Get original entity text
        const entityText = decoder.decode(
          source.subarray(entityRef.byteOffset, entityRef.byteOffset + entityRef.byteLength),
        );

        // Remap IDs if this is not the first model or if offset is non-zero
        if (offset === 0 && sharedRemap.size === 0) {
          allEntityLines.push(entityText);
        } else {
          const remapped = this.remapEntityText(entityText, offset, sharedRemap);
          allEntityLines.push(remapped);
        }
      }

      // For subsequent models, create IfcRelAggregates linking their sites/buildings
      // to the first model's site
      if (!isFirstModel && firstModelSiteIds.length > 0) {
        const firstSiteId = firstModelSiteIds[0] + (modelOffsets.get(firstModel.id) ?? 0);
        const buildingIds = this.findEntitiesByType(model.dataStore, 'IFCBUILDING');
        const siteIds = this.findEntitiesByType(model.dataStore, 'IFCSITE');
        const attachIds = [...buildingIds, ...siteIds];

        if (attachIds.length > 0) {
          const remappedAttachIds = attachIds.map(id => id + offset);
          const relId = nextAvailableId++;
          const globalId = this.generateGlobalId();
          const refs = remappedAttachIds.map(id => `#${id}`).join(',');
          allEntityLines.push(
            `#${relId}=IFCRELAGGREGATES('${globalId}',$,'MergedModels','Merged from ${model.name}',(${refs}),#${firstSiteId});`,
          );
        }
      }

      isFirstModel = false;
    }

    // Assemble final file
    const dataSection = allEntityLines.join('\n');
    const content = `${header}DATA;\n${dataSection}\nENDSEC;\nEND-ISO-10303-21;\n`;
    const fileSize = new TextEncoder().encode(content).length;

    return {
      content,
      stats: {
        modelCount: this.models.length,
        totalEntityCount: allEntityLines.length,
        fileSize,
      },
    };
  }

  /**
   * Remap all #ID references in a STEP entity line.
   * Applies offset to all IDs, then overrides with specific remappings.
   */
  private remapEntityText(
    entityText: string,
    offset: number,
    sharedRemap: Map<number, number>,
  ): string {
    return entityText.replace(STEP_REF_REGEX, (_match, idStr: string) => {
      const originalId = parseInt(idStr, 10);

      // Check if this ID has a specific remap (shared infrastructure)
      const remapped = sharedRemap.get(originalId);
      if (remapped !== undefined && remapped !== -1) {
        return `#${remapped}`;
      }

      // Apply offset
      return `#${originalId + offset}`;
    });
  }

  /**
   * Find entity IDs of shared infrastructure types in a data store.
   * Returns a map of uppercase type name → array of expressIds.
   */
  private findInfrastructureEntities(
    dataStore: IfcDataStore,
  ): Map<string, number[]> {
    const result = new Map<string, number[]>();

    for (const type of SHARED_INFRASTRUCTURE_TYPES) {
      const ids = dataStore.entityIndex.byType.get(type) ?? [];
      if (ids.length > 0) {
        result.set(type, [...ids]);
      }
    }

    return result;
  }

  /**
   * Find entity IDs of a specific type in a data store.
   */
  private findEntitiesByType(dataStore: IfcDataStore, typeUpper: string): number[] {
    return dataStore.entityIndex.byType.get(typeUpper) ?? [];
  }

  /**
   * Generate a new IFC GlobalId (22 character base64).
   */
  private generateGlobalId(): string {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
    let result = '';
    for (let i = 0; i < 22; i++) {
      result += chars[Math.floor(Math.random() * 64)];
    }
    return result;
  }
}
