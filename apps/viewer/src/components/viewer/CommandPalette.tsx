/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CommandPalette — Ctrl+K / Cmd+K fuzzy-searchable command palette.
 *
 * Provides quick access to script templates, panel toggles, and
 * viewer actions without adding toolbar buttons.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import {
  FileCode2,
  Play,
  Eye,
  EyeOff,
  Palette,
  ClipboardCheck,
  MessageSquare,
  FileSpreadsheet,
  Layout,
  TreeDeciduous,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useSandbox } from '@/hooks/useSandbox';
import { SCRIPT_TEMPLATES } from '@/lib/scripts/templates';

interface Command {
  id: string;
  label: string;
  description: string;
  category: 'Scripts' | 'View' | 'Tools';
  icon: React.ElementType;
  action: () => void;
}

/** Simple fuzzy match: all characters of query appear in order in target */
function fuzzyMatch(query: string, target: string): boolean {
  const lower = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < query.length; i++) {
    if (lower[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { execute } = useSandbox();

  // Store actions for panel toggles
  const toggleScriptPanel = useViewerStore((s) => s.toggleScriptPanel);
  const toggleBcfPanel = useViewerStore((s) => s.toggleBcfPanel);
  const toggleIdsPanel = useViewerStore((s) => s.toggleIdsPanel);
  const toggleListPanel = useViewerStore((s) => s.toggleListPanel);
  const toggleLensPanel = useViewerStore((s) => s.toggleLensPanel);
  const setScriptPanelVisible = useViewerStore((s) => s.setScriptPanelVisible);
  const setScriptEditorContent = useViewerStore((s) => s.setScriptEditorContent);
  const setRightPanelCollapsed = useViewerStore((s) => s.setRightPanelCollapsed);

  // Build command list
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // Script templates — run immediately
    for (const template of SCRIPT_TEMPLATES) {
      cmds.push({
        id: `script:${template.name}`,
        label: template.name,
        description: template.description,
        category: 'Scripts',
        icon: Play,
        action: () => {
          // Load into editor and execute
          setScriptPanelVisible(true);
          setScriptEditorContent(template.code);
          execute(template.code);
        },
      });
    }

    // Panel toggles
    cmds.push({
      id: 'view:script-editor',
      label: 'Toggle Script Editor',
      description: 'Show or hide the script editor panel',
      category: 'View',
      icon: FileCode2,
      action: () => { toggleScriptPanel(); },
    });
    cmds.push({
      id: 'view:properties',
      label: 'Toggle Properties',
      description: 'Show or hide the properties panel',
      category: 'View',
      icon: Layout,
      action: () => { setRightPanelCollapsed(false); },
    });
    cmds.push({
      id: 'view:spatial-tree',
      label: 'Toggle Spatial Tree',
      description: 'Show or hide the spatial hierarchy tree',
      category: 'View',
      icon: TreeDeciduous,
      action: () => {
        const state = useViewerStore.getState();
        useViewerStore.setState({ leftPanelCollapsed: !state.leftPanelCollapsed });
      },
    });
    cmds.push({
      id: 'view:bcf',
      label: 'Toggle BCF Issues',
      description: 'Show or hide the BCF collaboration panel',
      category: 'View',
      icon: MessageSquare,
      action: () => { setRightPanelCollapsed(false); toggleBcfPanel(); },
    });
    cmds.push({
      id: 'view:ids',
      label: 'Toggle IDS Validation',
      description: 'Show or hide the IDS validation panel',
      category: 'View',
      icon: ClipboardCheck,
      action: () => { setRightPanelCollapsed(false); toggleIdsPanel(); },
    });
    cmds.push({
      id: 'view:lists',
      label: 'Toggle Lists',
      description: 'Show or hide the entity lists panel',
      category: 'View',
      icon: FileSpreadsheet,
      action: () => { setRightPanelCollapsed(false); toggleListPanel(); },
    });
    cmds.push({
      id: 'view:lens',
      label: 'Toggle Lens',
      description: 'Show or hide lens color rules panel',
      category: 'View',
      icon: Palette,
      action: () => { setRightPanelCollapsed(false); toggleLensPanel(); },
    });

    // Tools
    cmds.push({
      id: 'tools:show-all',
      label: 'Show All Entities',
      description: 'Reset visibility — show all hidden entities',
      category: 'Tools',
      icon: Eye,
      action: () => {
        const state = useViewerStore.getState();
        state.showAll();
        state.clearStoreySelection();
      },
    });
    cmds.push({
      id: 'tools:reset-colors',
      label: 'Reset Colors',
      description: 'Clear all color overrides from the viewer',
      category: 'Tools',
      icon: EyeOff,
      action: () => {
        // Execute reset via script
        execute('bim.viewer.resetColors()\nconsole.log("Colors reset")');
      },
    });

    return cmds;
  }, [
    execute,
    setScriptPanelVisible,
    setScriptEditorContent,
    toggleScriptPanel,
    toggleBcfPanel,
    toggleIdsPanel,
    toggleListPanel,
    toggleLensPanel,
    setRightPanelCollapsed,
  ]);

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query) return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) => fuzzyMatch(q, cmd.label) || fuzzyMatch(q, cmd.description) || fuzzyMatch(q, cmd.category),
    );
  }, [commands, query]);

  // Reset selection when query or open state changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, open]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      // Focus after dialog animation
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const runCommand = useCallback((cmd: Command) => {
    onOpenChange(false);
    // Defer action to after dialog closes
    requestAnimationFrame(() => cmd.action());
  }, [onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIndex];
      if (cmd) runCommand(cmd);
    }
  }, [filtered, selectedIndex, runCommand]);

  // Group filtered commands by category
  const grouped = useMemo(() => {
    const groups: { category: string; commands: Command[] }[] = [];
    const categoryOrder = ['Scripts', 'View', 'Tools'];
    for (const cat of categoryOrder) {
      const cmds = filtered.filter((c) => c.category === cat);
      if (cmds.length > 0) groups.push({ category: cat, commands: cmds });
    }
    return groups;
  }, [filtered]);

  // Build flat list for arrow-key indexing with category headers excluded
  const flatItems = useMemo(() => filtered, [filtered]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-lg overflow-hidden" aria-label="Command palette">
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
            Esc
          </kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1" role="listbox">
          {flatItems.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matching commands
            </div>
          )}

          {grouped.map((group) => (
            <div key={group.category}>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </div>
              {group.commands.map((cmd) => {
                const idx = flatItems.indexOf(cmd);
                const Icon = cmd.icon;
                return (
                  <button
                    key={cmd.id}
                    role="option"
                    aria-selected={idx === selectedIndex}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-1.5 text-left text-sm hover:bg-accent/50 transition-colors',
                      idx === selectedIndex && 'bg-accent',
                    )}
                    onClick={() => runCommand(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{cmd.label}</div>
                      <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-3 px-3 py-1.5 border-t text-[10px] text-muted-foreground">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> run</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
