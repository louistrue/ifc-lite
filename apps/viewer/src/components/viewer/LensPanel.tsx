/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens panel — rule-based 3D filtering and coloring
 *
 * Shows saved lens presets and allows activating/deactivating them.
 * When a lens is active, a color legend displays the matched rules.
 */

import { useCallback } from 'react';
import { X, Eye, EyeOff, Palette, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useLens } from '@/hooks/useLens';
import type { Lens, LensRule } from '@/store/slices/lensSlice';

interface LensPanelProps {
  onClose?: () => void;
}

/** Single rule row showing color swatch, name, and action */
function RuleRow({ rule }: { rule: LensRule }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs',
        !rule.enabled && 'opacity-40',
      )}
    >
      {/* Color swatch */}
      <div
        className="w-3 h-3 border border-zinc-300 dark:border-zinc-600 flex-shrink-0"
        style={{ backgroundColor: rule.color }}
      />
      <span className="flex-1 truncate text-zinc-800 dark:text-zinc-200">
        {rule.name}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
        {rule.action}
      </span>
    </div>
  );
}

/** Lens card showing name and activation state */
function LensCard({
  lens,
  isActive,
  onToggle,
}: {
  lens: Lens;
  isActive: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        'border-2 transition-colors cursor-pointer',
        isActive
          ? 'border-primary bg-primary/5 dark:bg-primary/10'
          : 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 hover:border-zinc-300 dark:hover:border-zinc-700',
      )}
      onClick={() => onToggle(lens.id)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {isActive ? (
            <Check className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Palette className="h-3.5 w-3.5 text-zinc-400" />
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100">
            {lens.name}
          </span>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
          {lens.rules.filter(r => r.enabled).length} rules
        </span>
      </div>

      {/* Color legend (shown when active) */}
      {isActive && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 py-1">
          {lens.rules.map(rule => (
            <RuleRow key={rule.id} rule={rule} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LensPanel({ onClose }: LensPanelProps) {
  const { activeLensId, savedLenses } = useLens();
  const setActiveLens = useViewerStore((s) => s.setActiveLens);
  const lensHiddenIds = useViewerStore((s) => s.lensHiddenIds);
  const hideEntities = useViewerStore((s) => s.hideEntities);
  const showAll = useViewerStore((s) => s.showAll);

  const handleToggle = useCallback((id: string) => {
    if (activeLensId === id) {
      // Deactivate — restore visibility
      setActiveLens(null);
      showAll();
    } else {
      setActiveLens(id);
    }
  }, [activeLensId, setActiveLens, showAll]);

  // When lens hidden IDs change and we have an active lens, apply hiding
  // This runs as a side effect of lens evaluation (useLens hook)
  // We apply the hiding here because HierarchyPanel's visibility system is used
  const handleApplyHidden = useCallback(() => {
    if (lensHiddenIds.size > 0) {
      hideEntities(Array.from(lensHiddenIds));
    }
  }, [lensHiddenIds, hideEntities]);

  // Apply hidden entities when they change
  if (lensHiddenIds.size > 0 && activeLensId) {
    // Defer to avoid calling during render
    queueMicrotask(handleApplyHidden);
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-black">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Lens
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {activeLensId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] uppercase tracking-wider rounded-none"
              onClick={() => { setActiveLens(null); showAll(); }}
            >
              <EyeOff className="h-3 w-3 mr-1" />
              Clear
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 rounded-none"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Lens list */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {savedLenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Eye className="h-8 w-8 text-zinc-300 dark:text-zinc-700 mb-2" />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              No lenses defined
            </p>
          </div>
        ) : (
          savedLenses.map(lens => (
            <LensCard
              key={lens.id}
              lens={lens}
              isActive={activeLensId === lens.id}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>

      {/* Status footer */}
      <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-500 text-center bg-zinc-50 dark:bg-black font-mono">
        {activeLensId
          ? `Active · ${lensHiddenIds.size > 0 ? `${lensHiddenIds.size} hidden` : 'Colorized'}`
          : 'Click a lens to activate'}
      </div>
    </div>
  );
}
