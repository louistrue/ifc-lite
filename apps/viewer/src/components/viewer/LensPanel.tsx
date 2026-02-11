/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Lens panel — rule-based 3D filtering and coloring
 *
 * Shows saved lens presets and allows activating/deactivating them.
 * Users can create, edit, and delete custom lenses with full rule editing.
 * When a lens is active, a color legend displays the matched rules.
 * Unmatched entities are ghosted (semi-transparent) for visual context.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { X, EyeOff, Palette, Check, Plus, Trash2, Pencil, Save, Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';
import { useLens } from '@/hooks/useLens';
import type { Lens, LensRule } from '@/store/slices/lensSlice';
import { COMMON_IFC_CLASSES, LENS_PALETTE } from '@/store/slices/lensSlice';

/** Format large counts compactly: 1234 → "1.2k" */
function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface LensPanelProps {
  onClose?: () => void;
}

// ─── Rule display (read-only, clickable for isolation) ──────────────────────

const RuleRow = memo(function RuleRow({
  rule,
  count,
  isIsolated,
  onClick,
}: {
  rule: LensRule;
  count: number;
  isIsolated?: boolean;
  onClick?: () => void;
}) {
  const isEmpty = count === 0;
  const isClickable = !!onClick && !isEmpty;

  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-2 pl-3 pr-3 py-1.5 text-xs',
        'border-l-2 transition-[border-color,background-color] duration-100',
        !rule.enabled && 'opacity-40',
        // Default: transparent left border
        !isIsolated && !isEmpty && 'border-l-transparent',
        // Hover: accent left border + subtle bg (only for clickable rows)
        isClickable && 'cursor-pointer hover:border-l-primary/70 hover:bg-zinc-100/80 dark:hover:bg-zinc-700/40',
        // Isolated: solid accent border + bg
        isIsolated && 'border-l-primary bg-primary/8 dark:bg-primary/15',
        // Empty: muted, non-interactive
        isEmpty && 'border-l-transparent opacity-50 cursor-default',
      )}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={(e) => { if (isClickable) { e.stopPropagation(); onClick(); } }}
      onKeyDown={(e) => { if (isClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick(); } }}
      title={isClickable ? 'Click to isolate / show only this class' : isEmpty ? 'No matching entities' : undefined}
    >
      <div
        className={cn(
          'w-3 h-3 rounded-sm flex-shrink-0 ring-1 ring-black/10 dark:ring-white/20',
          isEmpty && 'grayscale',
        )}
        style={{ backgroundColor: rule.color }}
      />
      <span className={cn(
        'flex-1 truncate font-medium',
        isIsolated
          ? 'text-zinc-900 dark:text-zinc-50'
          : isEmpty
            ? 'text-zinc-400 dark:text-zinc-600'
            : 'text-zinc-900 dark:text-zinc-50',
      )}>
        {rule.name}
      </span>
      {isIsolated && (
        <span className="text-[10px] uppercase tracking-wider font-bold text-primary">
          isolated
        </span>
      )}
      <span className={cn(
        'text-[10px] tabular-nums font-mono min-w-[2ch] text-right',
        isEmpty
          ? 'text-zinc-300 dark:text-zinc-700'
          : 'text-zinc-400 dark:text-zinc-500',
      )}>
        {isEmpty ? '—' : formatCount(count)}
      </span>
    </div>
  );
});

// ─── Rule editor (inline editing) ───────────────────────────────────────────

function RuleEditor({
  rule,
  onChange,
  onRemove,
}: {
  rule: LensRule;
  onChange: (patch: Partial<LensRule>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5">
      <input
        type="color"
        value={rule.color}
        onChange={(e) => onChange({ color: e.target.value })}
        className="w-6 h-6 cursor-pointer border-0 p-0 bg-transparent flex-shrink-0 rounded"
      />
      <select
        value={rule.criteria.ifcType ?? ''}
        onChange={(e) => {
          const ifcType = e.target.value;
          onChange({
            criteria: { type: 'ifcType', ifcType },
            name: ifcType ? ifcType.replace('Ifc', '') : rule.name,
          });
        }}
        className="flex-1 min-w-0 text-xs px-1.5 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100 rounded-sm"
      >
        <option value="">Class...</option>
        {COMMON_IFC_CLASSES.map(t => (
          <option key={t} value={t}>{t.replace('Ifc', '')}</option>
        ))}
      </select>
      <select
        value={rule.action}
        onChange={(e) => onChange({ action: e.target.value as LensRule['action'] })}
        className="text-xs px-1.5 py-1 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100 rounded-sm w-[72px]"
      >
        <option value="colorize">Color</option>
        <option value="transparent">Transp</option>
        <option value="hide">Hide</option>
      </select>
      <button
        onClick={onRemove}
        className="text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 p-0.5 flex-shrink-0"
        title="Remove rule"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Lens editor (create/edit mode) ─────────────────────────────────────────

function LensEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Lens;
  onSave: (lens: Lens) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [rules, setRules] = useState<LensRule[]>(() =>
    initial.rules.map(r => ({ ...r })),
  );

  const addRule = () => {
    const colorIndex = rules.length % LENS_PALETTE.length;
    setRules([...rules, {
      id: `rule-${Date.now()}-${rules.length}`,
      name: 'New Rule',
      enabled: true,
      criteria: { type: 'ifcType', ifcType: '' },
      action: 'colorize',
      color: LENS_PALETTE[colorIndex],
    }]);
  };

  const updateRule = (index: number, patch: Partial<LensRule>) => {
    setRules(rules.map((r, i) => i === index ? { ...r, ...patch } : r));
  };

  const removeRule = (index: number) => {
    setRules(rules.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    const validRules = rules.filter(r => r.criteria.ifcType);
    if (!name.trim() || validRules.length === 0) return;
    onSave({ ...initial, name: name.trim(), rules: validRules });
  };

  const canSave = name.trim().length > 0 && rules.some(r => r.criteria.ifcType);

  return (
    <div className="border-2 border-primary bg-white dark:bg-zinc-900 rounded-sm">
      {/* Name input */}
      <div className="px-3 pt-3 pb-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lens name..."
          className="w-full px-2 py-1.5 text-xs font-bold uppercase tracking-wider bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-900 dark:text-zinc-100 rounded-sm placeholder:normal-case placeholder:font-normal placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          autoFocus
        />
      </div>

      {/* Rules */}
      <div className="border-t border-zinc-200 dark:border-zinc-700 py-1 bg-zinc-50/50 dark:bg-zinc-800/50">
        {rules.map((rule, i) => (
          <RuleEditor
            key={rule.id}
            rule={rule}
            onChange={(patch) => updateRule(i, patch)}
            onRemove={() => removeRule(i)}
          />
        ))}

        <button
          onClick={addRule}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary hover:text-primary/80 w-full"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Rule
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-1.5 p-2 border-t border-zinc-200 dark:border-zinc-700">
        <Button
          variant="default"
          size="sm"
          className="flex-1 h-7 text-[10px] uppercase tracking-wider rounded-sm"
          onClick={handleSave}
          disabled={!canSave}
        >
          <Save className="h-3 w-3 mr-1" />
          Save
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-[10px] uppercase tracking-wider rounded-sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Lens card (read-only display) ──────────────────────────────────────────

function LensCard({
  lens,
  isActive,
  onToggle,
  onEdit,
  onDelete,
  isolatedRuleId,
  onIsolateRule,
  ruleCounts,
}: {
  lens: Lens;
  isActive: boolean;
  onToggle: (id: string) => void;
  onEdit?: (lens: Lens) => void;
  onDelete?: (id: string) => void;
  isolatedRuleId?: string | null;
  onIsolateRule?: (ruleId: string) => void;
  ruleCounts?: Map<string, number>;
}) {
  return (
    <div
      className={cn(
        'border-2 transition-colors cursor-pointer group rounded-sm',
        isActive
          ? 'border-primary bg-white dark:bg-zinc-900'
          : 'border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-zinc-400 dark:hover:border-zinc-500',
      )}
      onClick={() => onToggle(lens.id)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          {isActive ? (
            <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          ) : (
            <Palette className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500 flex-shrink-0" />
          )}
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-zinc-100 truncate">
            {lens.name}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Edit for all lenses, delete for custom only */}
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(lens); }}
              className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-200 p-0.5"
              title="Edit lens"
            >
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {!lens.builtin && onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(lens.id); }}
              className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400 p-0.5"
              title="Delete lens"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 font-mono ml-1">
            {lens.rules.filter(r => r.enabled).length} rules
          </span>
        </div>
      </div>

      {/* Color legend (shown when active) — click rules to isolate */}
      {isActive && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 py-0.5 bg-zinc-50 dark:bg-zinc-800/60">
          {lens.rules.map(rule => {
            const count = ruleCounts?.get(rule.id) ?? 0;
            return (
              <RuleRow
                key={rule.id}
                rule={rule}
                count={count}
                isIsolated={isolatedRuleId === rule.id}
                onClick={onIsolateRule ? () => onIsolateRule(rule.id) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export function LensPanel({ onClose }: LensPanelProps) {
  const { activeLensId, savedLenses } = useLens();
  const setActiveLens = useViewerStore((s) => s.setActiveLens);
  const createLens = useViewerStore((s) => s.createLens);
  const updateLens = useViewerStore((s) => s.updateLens);
  const deleteLens = useViewerStore((s) => s.deleteLens);
  const importLenses = useViewerStore((s) => s.importLenses);
  const exportLenses = useViewerStore((s) => s.exportLenses);
  const hideEntities = useViewerStore((s) => s.hideEntities);
  const showAll = useViewerStore((s) => s.showAll);
  const isolateEntities = useViewerStore((s) => s.isolateEntities);
  const clearIsolation = useViewerStore((s) => s.clearIsolation);
  // For footer stats — cheap primitive subscriptions
  const lensColorMapSize = useViewerStore((s) => s.lensColorMap.size);
  const lensHiddenIdsSize = useViewerStore((s) => s.lensHiddenIds.size);
  const lensRuleCounts = useViewerStore((s) => s.lensRuleCounts);

  // Editor state: null = not editing, Lens object = editing/creating
  const [editingLens, setEditingLens] = useState<Lens | null>(null);
  const [isolatedRuleId, setIsolatedRuleId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleToggle = useCallback((id: string) => {
    setIsolatedRuleId(null);
    if (activeLensId === id) {
      setActiveLens(null);
      showAll();
    } else {
      setActiveLens(id);
    }
  }, [activeLensId, setActiveLens, showAll]);

  /** Click a rule row in the active lens to isolate matching entities */
  const handleIsolateRule = useCallback((ruleId: string) => {
    const lens = savedLenses.find(l => l.id === activeLensId);
    if (!lens) return;

    // Toggle off if clicking the already-isolated rule
    if (isolatedRuleId === ruleId) {
      setIsolatedRuleId(null);
      clearIsolation();
      return;
    }

    const rule = lens.rules.find(r => r.id === ruleId);
    if (!rule || !rule.enabled) return;

    // Look up entities matched by this specific rule (not by color)
    const matchingIds = useViewerStore.getState().lensRuleEntityIds.get(ruleId);
    if (!matchingIds || matchingIds.length === 0) return;

    if (matchingIds.length > 0) {
      setIsolatedRuleId(ruleId);
      isolateEntities(matchingIds);
    }
  }, [activeLensId, savedLenses, isolatedRuleId, isolateEntities, clearIsolation]);

  const handleNewLens = useCallback(() => {
    setEditingLens({
      id: `lens-${Date.now()}`,
      name: '',
      rules: [],
    });
  }, []);

  const handleEditLens = useCallback((lens: Lens) => {
    setEditingLens({ ...lens, rules: lens.rules.map(r => ({ ...r })) });
  }, []);

  const handleSaveLens = useCallback((lens: Lens) => {
    // Check if this is an existing lens or new
    const exists = savedLenses.some(l => l.id === lens.id);
    if (exists) {
      updateLens(lens.id, { name: lens.name, rules: lens.rules });
    } else {
      createLens(lens);
    }
    setEditingLens(null);
  }, [savedLenses, createLens, updateLens]);

  const handleDeleteLens = useCallback((id: string) => {
    if (activeLensId === id) {
      setActiveLens(null);
      showAll();
    }
    deleteLens(id);
  }, [activeLensId, setActiveLens, showAll, deleteLens]);

  // Apply hidden entities when lens hidden IDs change (proper effect, not render side-effect)
  useEffect(() => {
    if (lensHiddenIdsSize > 0 && activeLensId) {
      const ids = useViewerStore.getState().lensHiddenIds;
      hideEntities(Array.from(ids));
    }
  }, [activeLensId, lensHiddenIdsSize, hideEntities]);

  const handleExport = useCallback(() => {
    const data = exportLenses();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lenses.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [exportLenses]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        const arr: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        // Validate each entry has required Lens structure
        const valid = arr.filter((item): item is Lens => {
          if (item === null || typeof item !== 'object') return false;
          const obj = item as Record<string, unknown>;
          return typeof obj.id === 'string' && obj.id.length > 0
            && typeof obj.name === 'string' && obj.name.length > 0
            && Array.isArray(obj.rules);
        });
        if (valid.length > 0) {
          importLenses(valid);
        }
      } catch {
        // invalid JSON — silently ignore
      }
    };
    reader.readAsText(file);
    // reset so same file can be re-imported
    e.target.value = '';
  }, [importLenses]);

  return (
    <div className="h-full flex flex-col bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <h2 className="font-bold uppercase tracking-wider text-xs text-zinc-900 dark:text-zinc-100">
            Lens
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-sm"
            onClick={handleExport}
            title="Export lenses as JSON"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 rounded-sm"
            onClick={() => fileInputRef.current?.click()}
            title="Import lenses from JSON"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          {activeLensId && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] uppercase tracking-wider rounded-sm"
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
              className="h-7 w-7 p-0 rounded-sm"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Lens list + editor */}
      <div className="flex-1 overflow-auto p-3 space-y-2">
        {savedLenses.map(lens => (
          editingLens?.id === lens.id ? (
            <LensEditor
              key={lens.id}
              initial={editingLens}
              onSave={handleSaveLens}
              onCancel={() => setEditingLens(null)}
            />
          ) : (
            <LensCard
              key={lens.id}
              lens={lens}
              isActive={activeLensId === lens.id}
              onToggle={handleToggle}
              onEdit={handleEditLens}
              onDelete={handleDeleteLens}
              isolatedRuleId={activeLensId === lens.id ? isolatedRuleId : null}
              onIsolateRule={activeLensId === lens.id ? handleIsolateRule : undefined}
              ruleCounts={activeLensId === lens.id ? lensRuleCounts : undefined}
            />
          )
        ))}

        {/* New lens editor (when creating) */}
        {editingLens && !savedLenses.some(l => l.id === editingLens.id) && (
          <LensEditor
            initial={editingLens}
            onSave={handleSaveLens}
            onCancel={() => setEditingLens(null)}
          />
        )}

        {/* New lens button */}
        {!editingLens && (
          <button
            onClick={handleNewLens}
            className="w-full border-2 border-dashed border-zinc-300 dark:border-zinc-600 hover:border-primary dark:hover:border-primary py-2.5 flex items-center justify-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-primary transition-colors rounded-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            New Lens
          </button>
        )}
      </div>

      {/* Status footer */}
      <div className="p-2 border-t-2 border-zinc-200 dark:border-zinc-800 text-[10px] uppercase tracking-wide text-zinc-600 dark:text-zinc-400 text-center bg-zinc-50 dark:bg-zinc-900 font-mono">
        {activeLensId
          ? `Active · ${lensColorMapSize} colored · ${lensHiddenIdsSize > 0 ? `${lensHiddenIdsSize} hidden` : 'ghosted'}`
          : 'Click a lens to activate'}
      </div>
    </div>
  );
}
