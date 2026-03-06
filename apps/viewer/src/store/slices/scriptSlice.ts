/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Script state slice — manages script editor state, saved scripts,
 * and execution results.
 */

import type { StateCreator } from 'zustand';
import type { SavedScript } from '../../lib/scripts/persistence.js';
import { loadSavedScripts, saveScripts, validateScriptName, canCreateScript, isScriptWithinSizeLimit } from '../../lib/scripts/persistence.js';
import type { ScriptEditOperation, ScriptEditorSelection } from '../../lib/llm/types.js';
import { applyScriptEditOperations } from '../../lib/llm/script-edit-ops.js';

export type ScriptExecutionState = 'idle' | 'running' | 'error' | 'success';
const SCRIPT_PANEL_VISIBLE_STORAGE_KEY = 'ifc-lite-script-panel-visible';

export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'info';
  args: unknown[];
  timestamp: number;
}

export interface ScriptResult {
  value: unknown;
  logs: LogEntry[];
  durationMs: number;
}

export interface ScriptEditorApplyAdapter {
  apply: (nextContent: string, selection: ScriptEditorSelection) => void;
  undo: () => void;
  redo: () => void;
}

export interface ScriptApplyResult {
  ok: boolean;
  error?: string;
  appliedOpIds: string[];
}

export interface ScriptApplyOptions {
  acceptedBaseRevision?: number;
}

export interface ScriptSlice {
  // State
  savedScripts: SavedScript[];
  activeScriptId: string | null;
  scriptEditorContent: string;
  scriptEditorDirty: boolean;
  scriptExecutionState: ScriptExecutionState;
  scriptLastResult: ScriptResult | null;
  scriptLastError: string | null;
  scriptPanelVisible: boolean;
  scriptDeleteConfirmId: string | null;
  scriptEditorRevision: number;
  scriptEditorSelection: ScriptEditorSelection;
  scriptAppliedOpIds: Set<string>;
  scriptEditorApplyAdapter: ScriptEditorApplyAdapter | null;
  scriptCanUndo: boolean;
  scriptCanRedo: boolean;

  // Actions
  createScript: (name: string, code?: string) => string;
  saveActiveScript: () => void;
  deleteScript: (id: string) => void;
  renameScript: (id: string, name: string) => void;
  setActiveScriptId: (id: string | null) => void;
  setScriptEditorContent: (content: string) => void;
  setScriptExecutionState: (state: ScriptExecutionState) => void;
  setScriptResult: (result: ScriptResult | null) => void;
  setScriptError: (error: string | null) => void;
  setScriptPanelVisible: (visible: boolean) => void;
  toggleScriptPanel: () => void;
  setScriptDeleteConfirmId: (id: string | null) => void;
  setScriptCursorContext: (selection: ScriptEditorSelection) => void;
  registerScriptEditorApplyAdapter: (adapter: ScriptEditorApplyAdapter | null) => void;
  applyScriptEditOps: (ops: ScriptEditOperation[], options?: ScriptApplyOptions) => ScriptApplyResult;
  replaceScriptContentFallback: (content: string) => void;
  setScriptHistoryState: (canUndo: boolean, canRedo: boolean) => void;
  undoScriptEditor: () => void;
  redoScriptEditor: () => void;
}

const DEFAULT_CODE = `// Write your BIM script here
// The 'bim' object provides access to the SDK
const models = bim.model.list()
console.log('Loaded models:', models.length)

// Query all entities
const all = bim.query.all()
console.log('Total entities:', all.length)

// Count by type
const counts = {}
for (const e of all) {
  counts[e.type] = (counts[e.type] || 0) + 1
}
for (const [type, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log('  ' + type + ': ' + count)
}
`;

function loadStoredScriptPanelVisible(): boolean {
  try {
    return localStorage.getItem(SCRIPT_PANEL_VISIBLE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export const createScriptSlice: StateCreator<ScriptSlice, [], [], ScriptSlice> = (set, get) => ({
  // Initial state
  savedScripts: loadSavedScripts(),
  activeScriptId: null,
  scriptEditorContent: DEFAULT_CODE,
  scriptEditorDirty: false,
  scriptExecutionState: 'idle',
  scriptLastResult: null,
  scriptLastError: null,
  scriptPanelVisible: loadStoredScriptPanelVisible(),
  scriptDeleteConfirmId: null,
  scriptEditorRevision: 0,
  scriptEditorSelection: { from: 0, to: 0 },
  scriptAppliedOpIds: new Set(),
  scriptEditorApplyAdapter: null,
  scriptCanUndo: false,
  scriptCanRedo: false,

  // Actions
  createScript: (name, code) => {
    const { savedScripts } = get();
    if (!canCreateScript(savedScripts.length)) {
      console.warn('[Scripts] Maximum script limit reached');
      return '';
    }

    const validName = validateScriptName(name) ?? 'Untitled Script';
    const scriptCode = code ?? DEFAULT_CODE;
    if (!isScriptWithinSizeLimit(scriptCode)) {
      console.warn('[Scripts] Script code exceeds maximum size limit');
      return '';
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const script: SavedScript = {
      id,
      name: validName,
      code: scriptCode,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const updated = [...savedScripts, script];
    set({
      savedScripts: updated,
      activeScriptId: id,
      scriptEditorContent: script.code,
      scriptEditorDirty: false,
      scriptEditorRevision: get().scriptEditorRevision + 1,
      scriptEditorSelection: { from: script.code.length, to: script.code.length },
      scriptAppliedOpIds: new Set(),
    });
    const result = saveScripts(updated);
    if (!result.ok) {
      console.warn('[Scripts] Save failed:', result.message);
    }
    return id;
  },

  saveActiveScript: () => {
    const { activeScriptId, scriptEditorContent, savedScripts } = get();
    if (!activeScriptId) return;
    const updated = savedScripts.map((s) =>
      s.id === activeScriptId
        ? { ...s, code: scriptEditorContent, updatedAt: Date.now() }
        : s,
    );
    set({ savedScripts: updated, scriptEditorDirty: false });
    const result = saveScripts(updated);
    if (!result.ok) {
      console.warn('[Scripts] Save failed:', result.message);
    }
  },

  deleteScript: (id) => {
    const updated = get().savedScripts.filter((s) => s.id !== id);
    const activeScriptId = get().activeScriptId === id ? null : get().activeScriptId;
    const scriptEditorContent = activeScriptId === null ? DEFAULT_CODE : get().scriptEditorContent;
    set({
      savedScripts: updated,
      activeScriptId,
      scriptEditorContent,
      scriptEditorDirty: false,
      scriptDeleteConfirmId: null,
      scriptEditorRevision: get().scriptEditorRevision + 1,
      scriptEditorSelection: { from: scriptEditorContent.length, to: scriptEditorContent.length },
      scriptAppliedOpIds: new Set(),
    });
    saveScripts(updated);
  },

  renameScript: (id, name) => {
    const validName = validateScriptName(name);
    if (!validName) return;
    const updated = get().savedScripts.map((s) =>
      s.id === id ? { ...s, name: validName, updatedAt: Date.now() } : s,
    );
    set({ savedScripts: updated });
    saveScripts(updated);
  },

  setActiveScriptId: (activeScriptId) => {
    // Save current before switching
    const { activeScriptId: current, scriptEditorDirty } = get();
    if (current && scriptEditorDirty) {
      get().saveActiveScript();
    }

    if (activeScriptId) {
      const script = get().savedScripts.find((s) => s.id === activeScriptId);
      if (script) {
        set({
          activeScriptId,
          scriptEditorContent: script.code,
          scriptEditorDirty: false,
          scriptLastResult: null,
          scriptLastError: null,
          scriptExecutionState: 'idle',
          scriptEditorRevision: get().scriptEditorRevision + 1,
          scriptEditorSelection: { from: script.code.length, to: script.code.length },
          scriptAppliedOpIds: new Set(),
        });
        return;
      }
    }
    set({
      activeScriptId: null,
      scriptEditorContent: DEFAULT_CODE,
      scriptEditorDirty: false,
      scriptLastResult: null,
      scriptLastError: null,
      scriptExecutionState: 'idle',
      scriptEditorRevision: get().scriptEditorRevision + 1,
      scriptEditorSelection: { from: DEFAULT_CODE.length, to: DEFAULT_CODE.length },
      scriptAppliedOpIds: new Set(),
    });
  },

  setScriptEditorContent: (scriptEditorContent) => {
    set({
      scriptEditorContent,
      scriptEditorDirty: true,
      scriptEditorRevision: get().scriptEditorRevision + 1,
      scriptEditorSelection: { from: scriptEditorContent.length, to: scriptEditorContent.length },
      scriptAppliedOpIds: new Set(),
    });
  },

  setScriptExecutionState: (scriptExecutionState) => set({ scriptExecutionState }),

  setScriptResult: (scriptLastResult) =>
    set({ scriptLastResult, scriptLastError: null, scriptExecutionState: 'success' }),

  // Error and execution state are set independently — clearing an error
  // does NOT change execution state unless explicitly transitioned
  setScriptError: (scriptLastError) => {
    if (scriptLastError) {
      set({ scriptLastError, scriptExecutionState: 'error' });
    } else {
      set({ scriptLastError: null });
    }
  },

  setScriptPanelVisible: (scriptPanelVisible) => {
    try { localStorage.setItem(SCRIPT_PANEL_VISIBLE_STORAGE_KEY, String(scriptPanelVisible)); } catch { /* ignore */ }
    set({ scriptPanelVisible });
  },

  toggleScriptPanel: () => {
    const next = !get().scriptPanelVisible;
    try { localStorage.setItem(SCRIPT_PANEL_VISIBLE_STORAGE_KEY, String(next)); } catch { /* ignore */ }
    set({ scriptPanelVisible: next });
  },

  setScriptDeleteConfirmId: (scriptDeleteConfirmId) => set({ scriptDeleteConfirmId }),

  setScriptCursorContext: (scriptEditorSelection) => set({ scriptEditorSelection }),

  registerScriptEditorApplyAdapter: (scriptEditorApplyAdapter) => set({ scriptEditorApplyAdapter }),

  applyScriptEditOps: (ops, options) => {
    const state = get();
    const result = applyScriptEditOperations({
      content: state.scriptEditorContent,
      selection: state.scriptEditorSelection,
      revision: state.scriptEditorRevision,
      operations: ops,
      acceptedBaseRevision: options?.acceptedBaseRevision,
    });

    if (!result.ok) {
      return { ok: false, error: result.error, appliedOpIds: [] };
    }

    const appliedSet = new Set(state.scriptAppliedOpIds);
    result.appliedOpIds.forEach((id) => appliedSet.add(id));
    state.scriptEditorApplyAdapter?.apply(result.content, result.selection);
    set({
      scriptEditorContent: result.content,
      scriptEditorSelection: result.selection,
      scriptEditorRevision: result.revision,
      scriptEditorDirty: true,
      scriptAppliedOpIds: appliedSet,
    });
    return { ok: true, appliedOpIds: result.appliedOpIds };
  },

  replaceScriptContentFallback: (scriptEditorContent) => {
    const nextRevision = get().scriptEditorRevision + 1;
    const selection = { from: scriptEditorContent.length, to: scriptEditorContent.length };
    get().scriptEditorApplyAdapter?.apply(scriptEditorContent, selection);
    set({
      scriptEditorContent,
      scriptEditorDirty: true,
      scriptEditorRevision: nextRevision,
      scriptEditorSelection: selection,
      scriptAppliedOpIds: new Set(),
    });
  },

  setScriptHistoryState: (scriptCanUndo, scriptCanRedo) => set({ scriptCanUndo, scriptCanRedo }),

  undoScriptEditor: () => {
    get().scriptEditorApplyAdapter?.undo();
  },

  redoScriptEditor: () => {
    get().scriptEditorApplyAdapter?.redo();
  },
});
