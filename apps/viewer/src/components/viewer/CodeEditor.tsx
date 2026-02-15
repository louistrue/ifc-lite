/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CodeEditor — CodeMirror 6 wrapper for the script panel.
 *
 * Provides JavaScript/TypeScript editing with autocomplete for the bim.* API
 * surface. Completions are generated from the node registry at init time,
 * plus hardcoded entity proxy methods and the bridge-schema namespace map.
 */

import { useRef, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type CompletionResult, type Completion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';

/** Dark theme matching the viewer's dark mode */
const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: 'var(--foreground, #e4e4e7)',
    fontSize: '13px',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '8px 0',
    caretColor: 'var(--foreground, #e4e4e7)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground, #71717a)',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground, #e4e4e7)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(99,102,241,0.3)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--foreground, #e4e4e7)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover, #1c1c22)',
    color: 'var(--popover-foreground, #e4e4e7)',
    border: '1px solid var(--border, #27272a)',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: 'rgba(99,102,241,0.2)',
    },
  },
  '.cm-completionIcon': {
    display: 'none',
  },
}, { dark: true });

// ============================================================================
// Completion Generation
// ============================================================================

/** Namespace → method completions generated from bridge-schema + node registry */
interface NamespaceCompletions {
  namespace: string;
  detail: string;
  methods: Completion[];
}

/**
 * Build completions for bim.* SDK methods.
 * Lazily initialized once, then cached for all CodeEditor instances.
 */
let cachedCompletionMap: Map<string, NamespaceCompletions> | null = null;

function getCompletionMap(): Map<string, NamespaceCompletions> {
  if (cachedCompletionMap) return cachedCompletionMap;

  const map = new Map<string, NamespaceCompletions>();

  // Core namespaces with essential methods
  ensureNamespace(map, 'query', 'Query entities', [
    { label: 'bim.query.all()', type: 'function', detail: 'Get all entities' },
    { label: 'bim.query.byType(', type: 'function', detail: "Filter by IFC type e.g. 'IfcWall'" },
    { label: 'bim.query.entity(', type: 'function', detail: 'Get a specific entity by model ID and express ID' },
  ]);
  ensureNamespace(map, 'model', 'Model operations', [
    { label: 'bim.model.list()', type: 'function', detail: 'List loaded models' },
    { label: 'bim.model.active()', type: 'function', detail: 'Get active model' },
    { label: 'bim.model.activeId()', type: 'function', detail: 'Get active model ID' },
  ]);
  ensureNamespace(map, 'viewer', 'Viewer control', [
    { label: 'bim.viewer.colorize(', type: 'function', detail: "Colorize entities e.g. '#ff0000'" },
    { label: 'bim.viewer.hide(', type: 'function', detail: 'Hide entities' },
    { label: 'bim.viewer.show(', type: 'function', detail: 'Show entities' },
    { label: 'bim.viewer.isolate(', type: 'function', detail: 'Isolate entities' },
    { label: 'bim.viewer.select(', type: 'function', detail: 'Select entities' },
    { label: 'bim.viewer.flyTo(', type: 'function', detail: 'Fly camera to entities' },
    { label: 'bim.viewer.resetColors()', type: 'function', detail: 'Reset all colors' },
    { label: 'bim.viewer.resetVisibility()', type: 'function', detail: 'Reset all visibility' },
  ]);
  ensureNamespace(map, 'mutate', 'Property editing', [
    { label: 'bim.mutate.setProperty(', type: 'function', detail: 'Set a property value' },
    { label: 'bim.mutate.deleteProperty(', type: 'function', detail: 'Delete a property' },
    { label: 'bim.mutate.undo(', type: 'function', detail: 'Undo last mutation' },
    { label: 'bim.mutate.redo(', type: 'function', detail: 'Redo undone mutation' },
  ]);
  ensureNamespace(map, 'export', 'Data export', [
    { label: 'bim.export.csv(', type: 'function', detail: 'Export entities to CSV string' },
    { label: 'bim.export.json(', type: 'function', detail: 'Export entities to JSON array' },
  ]);
  ensureNamespace(map, 'lens', 'Lens visualization', [
    { label: 'bim.lens.presets()', type: 'function', detail: 'Get built-in lens presets' },
  ]);

  cachedCompletionMap = map;
  return map;
}

/** Ensure a namespace has at minimum the given fallback methods */
function ensureNamespace(map: Map<string, NamespaceCompletions>, ns: string, detail: string, fallbacks: Completion[]): void {
  if (!map.has(ns)) {
    map.set(ns, { namespace: ns, detail, methods: fallbacks });
    return;
  }
  // If registry provided some methods but we have essential fallbacks missing, merge them
  const existing = map.get(ns)!;
  const existingLabels = new Set(existing.methods.map(m => m.label));
  for (const fb of fallbacks) {
    if (!existingLabels.has(fb.label)) {
      existing.methods.push(fb);
    }
  }
}

/** bim.* API completions — generated from node registry */
function bimCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*$/);
  if (!word || (word.from === word.to && !context.explicit)) return null;

  const text = word.text;
  const completionMap = getCompletionMap();

  // Top-level bim completions
  if (text === 'bim' || text === 'bim.') {
    return {
      from: word.from,
      options: Array.from(completionMap.values()).map(ns => ({
        label: `bim.${ns.namespace}`,
        type: 'variable',
        detail: ns.detail,
      })),
    };
  }

  // Namespace method completions
  for (const [ns, data] of completionMap) {
    if (text.startsWith(`bim.${ns}`)) {
      return {
        from: word.from,
        options: data.methods,
      };
    }
  }

  // Entity proxy completions (works on any variable)
  if (text.endsWith('.properties') || text.endsWith('.property') || text.endsWith('.quantities') || text.endsWith('.quantity')) {
    return {
      from: word.from + text.lastIndexOf('.') + 1,
      options: [
        { label: 'properties()', type: 'function', detail: 'Get all property sets' },
        { label: 'property(', type: 'function', detail: "Get a property e.g. 'Pset', 'Name'" },
        { label: 'quantities()', type: 'function', detail: 'Get all quantity sets' },
        { label: 'quantity(', type: 'function', detail: "Get a quantity e.g. 'Qto', 'Length'" },
        { label: 'name', type: 'property', detail: 'Entity name' },
        { label: 'type', type: 'property', detail: 'IFC type name' },
        { label: 'globalId', type: 'property', detail: 'IFC GlobalId' },
        { label: 'ref', type: 'property', detail: 'Entity reference { modelId, expressId }' },
      ],
    };
  }

  return null;
}

// ============================================================================
// Component
// ============================================================================

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  onSave?: () => void;
  className?: string;
}

export function CodeEditor({ value, onChange, onRun, onSave, className }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);

  // Keep callback refs up to date without recreating the editor
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onSaveRef.current = onSave;

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return;

    const runKeymap = keymap.of([
      {
        key: 'Ctrl-Enter',
        mac: 'Cmd-Enter',
        run: () => { onRunRef.current?.(); return true; },
      },
      {
        key: 'Ctrl-s',
        mac: 'Cmd-s',
        run: () => { onSaveRef.current?.(); return true; },
      },
    ]);

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        bracketMatching(),
        indentOnInput(),
        history(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        javascript({ typescript: true }),
        autocompletion({
          override: [bimCompletions],
          activateOnTyping: true,
          maxRenderedOptions: 15,
        }),
        runKeymap,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        updateListener,
        darkTheme,
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create once — value is set via initial doc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes into the editor (e.g., loading a different script)
  const lastExternalValue = useRef(value);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Only update if value changed externally (not from our own onChange)
    if (value !== lastExternalValue.current && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
    lastExternalValue.current = value;
  }, [value]);

  return <div ref={containerRef} className={className} />;
}
