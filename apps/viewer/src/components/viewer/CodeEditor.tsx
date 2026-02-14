/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CodeEditor — CodeMirror 6 wrapper for the script panel.
 *
 * Provides JavaScript/TypeScript editing with basic autocomplete for
 * the bim.* API surface. Calls onChange for every edit.
 */

import { useRef, useEffect, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
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

/** bim.* API completions */
function bimCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[\w.]*$/);
  if (!word || word.from === word.to && !context.explicit) return null;

  const text = word.text;

  // Top-level bim completions
  if (text === 'bim' || text === 'bim.') {
    return {
      from: word.from,
      options: [
        { label: 'bim.query', type: 'function', detail: 'Query entities' },
        { label: 'bim.model', type: 'variable', detail: 'Model operations' },
        { label: 'bim.viewer', type: 'variable', detail: 'Viewer control' },
        { label: 'bim.mutate', type: 'variable', detail: 'Property editing' },
        { label: 'bim.export', type: 'variable', detail: 'Data export' },
        { label: 'bim.lens', type: 'variable', detail: 'Lens visualization' },
      ],
    };
  }

  // bim.query completions
  if (text.startsWith('bim.query')) {
    return {
      from: word.from,
      options: [
        { label: 'bim.query.all()', type: 'function', detail: 'Get all entities' },
        { label: 'bim.query.byType(', type: 'function', detail: "Filter by IFC type e.g. 'IfcWall'" },
      ],
    };
  }

  // bim.model completions
  if (text.startsWith('bim.model')) {
    return {
      from: word.from,
      options: [
        { label: 'bim.model.list()', type: 'function', detail: 'List loaded models' },
        { label: 'bim.model.active()', type: 'function', detail: 'Get active model' },
        { label: 'bim.model.activeId()', type: 'function', detail: 'Get active model ID' },
      ],
    };
  }

  // bim.viewer completions
  if (text.startsWith('bim.viewer')) {
    return {
      from: word.from,
      options: [
        { label: 'bim.viewer.colorize(', type: 'function', detail: "Colorize entities e.g. '#ff0000'" },
        { label: 'bim.viewer.hide(', type: 'function', detail: 'Hide entities' },
        { label: 'bim.viewer.show(', type: 'function', detail: 'Show entities' },
        { label: 'bim.viewer.isolate(', type: 'function', detail: 'Isolate entities' },
        { label: 'bim.viewer.select(', type: 'function', detail: 'Select entities' },
        { label: 'bim.viewer.flyTo(', type: 'function', detail: 'Fly camera to entities' },
        { label: 'bim.viewer.resetColors()', type: 'function', detail: 'Reset all colors' },
        { label: 'bim.viewer.resetVisibility()', type: 'function', detail: 'Reset all visibility' },
      ],
    };
  }

  // bim.mutate completions
  if (text.startsWith('bim.mutate')) {
    return {
      from: word.from,
      options: [
        { label: 'bim.mutate.setProperty(', type: 'function', detail: 'Set a property value' },
        { label: 'bim.mutate.deleteProperty(', type: 'function', detail: 'Delete a property' },
        { label: 'bim.mutate.undo(', type: 'function', detail: 'Undo last mutation' },
        { label: 'bim.mutate.redo(', type: 'function', detail: 'Redo undone mutation' },
      ],
    };
  }

  // bim.export completions
  if (text.startsWith('bim.export')) {
    return {
      from: word.from,
      options: [
        { label: 'bim.export.csv(', type: 'function', detail: 'Export to CSV' },
        { label: 'bim.export.json(', type: 'function', detail: 'Export to JSON' },
      ],
    };
  }

  // bim.lens completions
  if (text.startsWith('bim.lens')) {
    return {
      from: word.from,
      options: [
        { label: 'bim.lens.presets()', type: 'function', detail: 'Get built-in lens presets' },
      ],
    };
  }

  // Entity proxy completions
  if (text.endsWith('.properties') || text.endsWith('.property') || text.endsWith('.quantities')) {
    return {
      from: word.from - text.split('.').pop()!.length,
      options: [
        { label: 'properties()', type: 'function', detail: 'Get all property sets' },
        { label: 'property(', type: 'function', detail: "Get a property e.g. 'Pset', 'Name'" },
        { label: 'quantities()', type: 'function', detail: 'Get all quantity sets' },
        { label: 'quantity(', type: 'function', detail: "Get a quantity e.g. 'Qto', 'Length'" },
      ],
    };
  }

  return null;
}

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
