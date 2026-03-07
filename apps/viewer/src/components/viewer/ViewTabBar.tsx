/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ViewTabBar — Chrome-style tab bar above the center viewport.
 *
 * Always shows a "3D" tab. Additional tabs appear when the user opens
 * views from the ViewsPanel (double-click). Clicking a tab activates it;
 * clicking × closes it.
 */

import { Box, LayoutTemplate, Scissors, ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useViewerStore } from '@/store';

const TYPE_ICON = {
  floorplan: LayoutTemplate,
  section:   Scissors,
  elevation: ArrowRight,
} as const;

const TYPE_COLOR = {
  floorplan: '#3b82f6',
  section:   '#f97316',
  elevation: '#22c55e',
} as const;

export function ViewTabBar() {
  const openViewTabs  = useViewerStore((s) => s.openViewTabs);
  const activeTab     = useViewerStore((s) => s.activeTab);
  const views         = useViewerStore((s) => s.views);
  const setActiveTab  = useViewerStore((s) => s.setActiveTab);
  const closeViewTab  = useViewerStore((s) => s.closeViewTab);

  // Only render the bar when there are view tabs open
  if (openViewTabs.length === 0) return null;

  return (
    <div className="flex items-end gap-0 border-b bg-muted/30 shrink-0 overflow-x-auto overflow-y-hidden min-h-[34px]">
      {/* 3D tab — always present */}
      <Tab
        label="3D"
        isActive={activeTab === '3d'}
        icon={<Box className="h-3.5 w-3.5 shrink-0" />}
        onClick={() => setActiveTab('3d')}
      />

      {/* View tabs */}
      {openViewTabs.map((viewId) => {
        const view = views.get(viewId);
        if (!view) return null;
        const Icon  = TYPE_ICON[view.type] ?? LayoutTemplate;
        const color = TYPE_COLOR[view.type] ?? '#3b82f6';
        return (
          <Tab
            key={viewId}
            label={view.name}
            isActive={activeTab === viewId}
            icon={<Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />}
            onClose={(e) => {
              e.stopPropagation();
              closeViewTab(viewId);
            }}
            onClick={() => setActiveTab(viewId)}
          />
        );
      })}
    </div>
  );
}

// ─── Tab pill ─────────────────────────────────────────────────────────────────

interface TabProps {
  label: string;
  isActive: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  onClose?: (e: React.MouseEvent) => void;
}

function Tab({ label, isActive, icon, onClick, onClose }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex items-center gap-1.5 px-3 h-[33px] text-xs font-medium border-r border-border transition-colors shrink-0 max-w-[180px]',
        'select-none relative',
        isActive
          ? 'bg-background text-foreground border-b-2 border-b-primary -mb-px'
          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {onClose && (
        <span
          role="button"
          aria-label="Close tab"
          onClick={onClose}
          className={cn(
            'h-4 w-4 flex items-center justify-center rounded hover:bg-muted-foreground/20 ml-0.5 shrink-0',
            !isActive && 'opacity-0 group-hover:opacity-100',
          )}
        >
          <X className="h-2.5 w-2.5" />
        </span>
      )}
    </button>
  );
}
