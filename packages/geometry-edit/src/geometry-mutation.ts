/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Geometry Mutation Manager
 *
 * Tracks geometry mutations with full undo/redo support.
 * Per-parameter/edit granularity for immediate live feedback.
 */

import type { MeshData, Vec3 } from '@ifc-lite/geometry';
import {
  type GeometryMutation,
  type GeometryParameter,
  type EditSession,
  type EditableEntity,
  type ParameterValue,
  GeometryMutationType,
  EditMode,
  generateMutationId,
  generateSessionId,
} from './types.js';

/**
 * Event types for mutation manager
 */
export type MutationEventType =
  | 'mutation_applied'
  | 'mutation_undone'
  | 'mutation_redone'
  | 'session_started'
  | 'session_ended'
  | 'preview_updated';

/**
 * Mutation event data
 */
export interface MutationEvent {
  type: MutationEventType;
  mutation?: GeometryMutation;
  session?: EditSession;
  meshData?: MeshData;
}

/**
 * Mutation event listener
 */
export type MutationEventListener = (event: MutationEvent) => void;

/**
 * Manages geometry mutations with undo/redo
 */
export class GeometryMutationManager {
  /** All mutations, keyed by model ID */
  private mutations: Map<string, GeometryMutation[]> = new Map();

  /** Undo stack per model */
  private undoStacks: Map<string, GeometryMutation[]> = new Map();

  /** Redo stack per model */
  private redoStacks: Map<string, GeometryMutation[]> = new Map();

  /** Active edit sessions per entity (globalId -> session) */
  private sessions: Map<number, EditSession> = new Map();

  /** Current preview meshes (globalId -> previewMesh) */
  private previewMeshes: Map<number, MeshData> = new Map();

  /** Event listeners */
  private listeners: Set<MutationEventListener> = new Set();

  /** Maximum undo history size */
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  // =========================================================================
  // Event System
  // =========================================================================

  /**
   * Subscribe to mutation events
   */
  subscribe(listener: MutationEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: MutationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (e) {
        console.error('Mutation event listener error:', e);
      }
    }
  }

  // =========================================================================
  // Session Management
  // =========================================================================

  /**
   * Start an editing session for an entity
   */
  startSession(entity: EditableEntity): EditSession {
    // End any existing session for this entity
    if (this.sessions.has(entity.globalId)) {
      this.endSession(entity.globalId);
    }

    const session: EditSession = {
      id: generateSessionId(),
      entity,
      mode: entity.editMode,
      pendingMutations: [],
      previewMesh: entity.meshData,
      constraintViolations: [],
      startedAt: Date.now(),
      isDirty: false,
    };

    this.sessions.set(entity.globalId, session);
    this.previewMeshes.set(entity.globalId, entity.meshData);

    this.emit({ type: 'session_started', session });

    return session;
  }

  /**
   * Get active session for an entity
   */
  getSession(globalId: number): EditSession | null {
    return this.sessions.get(globalId) || null;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): EditSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * End an editing session
   */
  endSession(globalId: number, commit: boolean = true): void {
    const session = this.sessions.get(globalId);
    if (!session) return;

    if (commit && session.pendingMutations.length > 0) {
      // Commit all pending mutations
      for (const mutation of session.pendingMutations) {
        this.commitMutation(mutation);
      }
    }

    this.sessions.delete(globalId);
    this.previewMeshes.delete(globalId);

    this.emit({ type: 'session_ended', session });
  }

  /**
   * Update session preview mesh
   */
  updateSessionPreview(globalId: number, meshData: MeshData): void {
    const session = this.sessions.get(globalId);
    if (session) {
      session.previewMesh = meshData;
      session.isDirty = true;
      this.previewMeshes.set(globalId, meshData);
      this.emit({ type: 'preview_updated', session, meshData });
    }
  }

  /**
   * Get preview mesh for an entity
   */
  getPreviewMesh(globalId: number): MeshData | null {
    return this.previewMeshes.get(globalId) || null;
  }

  // =========================================================================
  // Mutation Operations
  // =========================================================================

  /**
   * Create and apply a parameter change mutation
   */
  applyParameterChange(
    session: EditSession,
    parameter: GeometryParameter,
    newValue: ParameterValue,
    newMeshData: MeshData
  ): GeometryMutation {
    const mutation: GeometryMutation = {
      id: generateMutationId(),
      type: GeometryMutationType.ParameterChange,
      timestamp: Date.now(),
      modelId: parameter.modelId,
      entityId: parameter.entityId,
      globalId: session.entity.globalId,
      parameterPath: parameter.path,
      oldValue: parameter.value,
      newValue,
      oldMeshData: session.previewMesh,
      newMeshData,
    };

    // Add to session's pending mutations
    session.pendingMutations.push(mutation);
    session.previewMesh = newMeshData;
    session.isDirty = true;

    // Update preview
    this.previewMeshes.set(session.entity.globalId, newMeshData);

    this.emit({ type: 'mutation_applied', mutation, session, meshData: newMeshData });

    // Auto-commit for live preview
    this.commitMutation(mutation);

    return mutation;
  }

  /**
   * Create and apply a mesh edit mutation
   */
  applyMeshEdit(
    session: EditSession,
    type: GeometryMutationType,
    vertexIndices: number[] | undefined,
    faceIndices: number[] | undefined,
    delta: Vec3,
    newMeshData: MeshData
  ): GeometryMutation {
    const mutation: GeometryMutation = {
      id: generateMutationId(),
      type,
      timestamp: Date.now(),
      modelId: session.entity.modelId,
      entityId: session.entity.expressId,
      globalId: session.entity.globalId,
      vertexIndices,
      faceIndices,
      delta,
      oldMeshData: session.previewMesh,
      newMeshData,
    };

    session.pendingMutations.push(mutation);
    session.previewMesh = newMeshData;
    session.isDirty = true;

    this.previewMeshes.set(session.entity.globalId, newMeshData);

    this.emit({ type: 'mutation_applied', mutation, session, meshData: newMeshData });

    // Auto-commit for live preview
    this.commitMutation(mutation);

    return mutation;
  }

  /**
   * Commit a mutation to the history
   */
  private commitMutation(mutation: GeometryMutation): void {
    const modelId = mutation.modelId;

    // Get or create mutations list
    if (!this.mutations.has(modelId)) {
      this.mutations.set(modelId, []);
    }
    this.mutations.get(modelId)!.push(mutation);

    // Add to undo stack
    if (!this.undoStacks.has(modelId)) {
      this.undoStacks.set(modelId, []);
    }
    const undoStack = this.undoStacks.get(modelId)!;
    undoStack.push(mutation);

    // Trim undo stack if too large
    while (undoStack.length > this.maxHistorySize) {
      undoStack.shift();
    }

    // Clear redo stack on new mutation
    this.redoStacks.set(modelId, []);
  }

  // =========================================================================
  // Undo/Redo
  // =========================================================================

  /**
   * Undo last mutation for a model
   */
  undo(modelId: string): GeometryMutation | null {
    const undoStack = this.undoStacks.get(modelId);
    if (!undoStack || undoStack.length === 0) return null;

    const mutation = undoStack.pop()!;

    // Add to redo stack
    if (!this.redoStacks.has(modelId)) {
      this.redoStacks.set(modelId, []);
    }
    this.redoStacks.get(modelId)!.push(mutation);

    // Update preview if there's an active session
    if (mutation.oldMeshData) {
      const session = this.sessions.get(mutation.globalId);
      if (session) {
        session.previewMesh = mutation.oldMeshData;
        this.previewMeshes.set(mutation.globalId, mutation.oldMeshData);
      }
    }

    this.emit({
      type: 'mutation_undone',
      mutation,
      meshData: mutation.oldMeshData,
    });

    return mutation;
  }

  /**
   * Redo last undone mutation for a model
   */
  redo(modelId: string): GeometryMutation | null {
    const redoStack = this.redoStacks.get(modelId);
    if (!redoStack || redoStack.length === 0) return null;

    const mutation = redoStack.pop()!;

    // Add back to undo stack
    const undoStack = this.undoStacks.get(modelId) || [];
    undoStack.push(mutation);
    this.undoStacks.set(modelId, undoStack);

    // Update preview if there's an active session
    if (mutation.newMeshData) {
      const session = this.sessions.get(mutation.globalId);
      if (session) {
        session.previewMesh = mutation.newMeshData;
        this.previewMeshes.set(mutation.globalId, mutation.newMeshData);
      }
    }

    this.emit({
      type: 'mutation_redone',
      mutation,
      meshData: mutation.newMeshData,
    });

    return mutation;
  }

  /**
   * Check if undo is available
   */
  canUndo(modelId: string): boolean {
    const stack = this.undoStacks.get(modelId);
    return stack !== undefined && stack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(modelId: string): boolean {
    const stack = this.redoStacks.get(modelId);
    return stack !== undefined && stack.length > 0;
  }

  /**
   * Get undo stack size
   */
  getUndoStackSize(modelId: string): number {
    return this.undoStacks.get(modelId)?.length || 0;
  }

  /**
   * Get redo stack size
   */
  getRedoStackSize(modelId: string): number {
    return this.redoStacks.get(modelId)?.length || 0;
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  /**
   * Get all mutations for a model
   */
  getMutationsForModel(modelId: string): GeometryMutation[] {
    return this.mutations.get(modelId) || [];
  }

  /**
   * Get mutations for a specific entity
   */
  getMutationsForEntity(modelId: string, entityId: number): GeometryMutation[] {
    const modelMutations = this.mutations.get(modelId) || [];
    return modelMutations.filter((m) => m.entityId === entityId);
  }

  /**
   * Get total mutation count across all models
   */
  getTotalMutationCount(): number {
    let count = 0;
    for (const mutations of this.mutations.values()) {
      count += mutations.length;
    }
    return count;
  }

  /**
   * Get models with mutations
   */
  getModelsWithMutations(): string[] {
    const models: string[] = [];
    for (const [modelId, mutations] of this.mutations) {
      if (mutations.length > 0) {
        models.push(modelId);
      }
    }
    return models;
  }

  /**
   * Check if there are unsaved changes
   */
  hasUnsavedChanges(): boolean {
    for (const session of this.sessions.values()) {
      if (session.isDirty) return true;
    }
    return this.getTotalMutationCount() > 0;
  }

  // =========================================================================
  // Export/Import
  // =========================================================================

  /**
   * Export mutations as JSON
   */
  exportMutations(modelId?: string): string {
    const data: Record<string, GeometryMutation[]> = {};

    if (modelId) {
      data[modelId] = this.getMutationsForModel(modelId);
    } else {
      for (const [id, mutations] of this.mutations) {
        data[id] = mutations;
      }
    }

    return JSON.stringify(
      {
        version: 1,
        exportedAt: Date.now(),
        mutations: data,
      },
      null,
      2
    );
  }

  /**
   * Import mutations from JSON
   */
  importMutations(json: string): void {
    try {
      const data = JSON.parse(json);
      if (!data.mutations) return;

      for (const [modelId, mutations] of Object.entries(data.mutations)) {
        const existingMutations = this.mutations.get(modelId) || [];
        this.mutations.set(modelId, [
          ...existingMutations,
          ...(mutations as GeometryMutation[]),
        ]);
      }
    } catch (e) {
      console.error('Failed to import mutations:', e);
    }
  }

  // =========================================================================
  // Reset
  // =========================================================================

  /**
   * Clear all mutations for a model
   */
  clearMutations(modelId: string): void {
    this.mutations.delete(modelId);
    this.undoStacks.delete(modelId);
    this.redoStacks.delete(modelId);

    // End any sessions for this model
    for (const [globalId, session] of this.sessions) {
      if (session.entity.modelId === modelId) {
        this.sessions.delete(globalId);
        this.previewMeshes.delete(globalId);
      }
    }
  }

  /**
   * Clear all mutations
   */
  clearAllMutations(): void {
    this.mutations.clear();
    this.undoStacks.clear();
    this.redoStacks.clear();
    this.sessions.clear();
    this.previewMeshes.clear();
  }

  /**
   * Reset entity to original state
   */
  resetEntity(globalId: number): MeshData | null {
    const session = this.sessions.get(globalId);
    if (!session) return null;

    // Find original mesh from first mutation or entity
    const entityMutations = this.getMutationsForEntity(
      session.entity.modelId,
      session.entity.expressId
    );

    const originalMesh =
      entityMutations.length > 0
        ? entityMutations[0].oldMeshData || session.entity.meshData
        : session.entity.meshData;

    // Clear entity's mutations
    const modelMutations = this.mutations.get(session.entity.modelId) || [];
    this.mutations.set(
      session.entity.modelId,
      modelMutations.filter((m) => m.entityId !== session.entity.expressId)
    );

    // Update session
    session.previewMesh = originalMesh;
    session.pendingMutations = [];
    session.isDirty = false;
    this.previewMeshes.set(globalId, originalMesh);

    return originalMesh;
  }
}

/**
 * Create a geometry mutation manager
 */
export function createGeometryMutationManager(
  maxHistorySize?: number
): GeometryMutationManager {
  return new GeometryMutationManager(maxHistorySize);
}
