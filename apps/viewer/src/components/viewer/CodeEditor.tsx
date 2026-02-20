/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CodeEditor — CodeMirror 6 wrapper for the script panel.
 *
 * Provides JavaScript/TypeScript editing with autocomplete for the bim.* API
 * surface. Completions are auto-generated from the bridge-schema so they
 * stay in sync with the sandbox API automatically.
 */

import { useRef, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type CompletionResult, type Completion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import { NAMESPACE_SCHEMAS } from '@ifc-lite/sandbox/schema';

/** Shared structural styles (mode-agnostic) */
const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
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
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    paddingRight: '4px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '.cm-completionIcon': {
    display: 'none',
  },
});

/** Dark mode colors */
const darkTheme = EditorView.theme({
  '&': { color: '#e4e4e7' },
  '.cm-content': { caretColor: '#e4e4e7' },
  '.cm-gutters': { color: '#71717a' },
  '.cm-activeLineGutter': { color: '#e4e4e7' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(255,255,255,0.1)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(99,102,241,0.3)',
  },
  '.cm-cursor': { borderLeftColor: '#e4e4e7' },
  '.cm-tooltip': {
    backgroundColor: '#1c1c22',
    color: '#e4e4e7',
    border: '1px solid #27272a',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': { backgroundColor: 'rgba(99,102,241,0.2)' },
  },
}, { dark: true });

/** Light mode colors */
const lightTheme = EditorView.theme({
  '&': { color: '#18181b' },
  '.cm-content': { caretColor: '#18181b' },
  '.cm-gutters': { color: '#a1a1aa' },
  '.cm-activeLineGutter': { color: '#52525b' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.03)' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(99,102,241,0.15)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(99,102,241,0.2)',
  },
  '.cm-cursor': { borderLeftColor: '#18181b' },
  '.cm-tooltip': {
    backgroundColor: '#ffffff',
    color: '#18181b',
    border: '1px solid #e4e4e7',
    borderRadius: '6px',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': { backgroundColor: 'rgba(99,102,241,0.12)' },
  },
}, { dark: false });

/** Compartment for swapping light/dark theme at runtime */
const themeCompartment = new Compartment();

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

function getColorTheme() {
  return isDarkMode() ? darkTheme : lightTheme;
}

// ============================================================================
// Completion Generation (auto-generated from bridge-schema)
// ============================================================================

/** Namespace → method completions derived from NAMESPACE_SCHEMAS */
interface NamespaceCompletions {
  namespace: string;
  detail: string;
  methods: Completion[];
}

/**
 * Build completions for bim.* SDK methods from the bridge schema.
 * Lazily initialized once, then cached for all CodeEditor instances.
 */
let cachedCompletionMap: Map<string, NamespaceCompletions> | null = null;

function getCompletionMap(): Map<string, NamespaceCompletions> {
  if (cachedCompletionMap) return cachedCompletionMap;

  const map = new Map<string, NamespaceCompletions>();

  for (const ns of NAMESPACE_SCHEMAS) {
    const methods: Completion[] = ns.methods.map(m => ({
      label: m.args.length === 0
        ? `bim.${ns.name}.${m.name}()`   // no-arg methods get ()
        : `bim.${ns.name}.${m.name}(`,    // methods with args get (
      type: 'function',
      detail: m.doc,
    }));
    map.set(ns.name, { namespace: ns.name, detail: ns.doc, methods });
  }

  cachedCompletionMap = map;
  return map;
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

  // Entity data field completions — IFC attribute names (both PascalCase and camelCase work)
  if (text.endsWith('.Name') || text.endsWith('.Type') || text.endsWith('.GlobalId')
    || text.endsWith('.name') || text.endsWith('.type') || text.endsWith('.ref')) {
    return {
      from: word.from + text.lastIndexOf('.') + 1,
      options: [
        { label: 'Name', type: 'property', detail: 'IFC Name attribute (IfcLabel)' },
        { label: 'Type', type: 'property', detail: 'IFC entity type (e.g. IfcWall)' },
        { label: 'GlobalId', type: 'property', detail: 'IFC GlobalId (IfcGloballyUniqueId)' },
        { label: 'Description', type: 'property', detail: 'IFC Description attribute (IfcText)' },
        { label: 'ObjectType', type: 'property', detail: 'IFC ObjectType attribute (IfcLabel)' },
        { label: 'ref', type: 'property', detail: 'Entity reference { modelId, expressId }' },
        { label: 'name', type: 'property', detail: 'IFC Name (camelCase alias)' },
        { label: 'type', type: 'property', detail: 'IFC type (camelCase alias)' },
        { label: 'globalId', type: 'property', detail: 'IFC GlobalId (camelCase alias)' },
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
        baseTheme,
        themeCompartment.of(getColorTheme()),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Watch for light/dark mode changes on <html> class
    const observer = new MutationObserver(() => {
      view.dispatch({ effects: themeCompartment.reconfigure(getColorTheme()) });
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => {
      observer.disconnect();
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
