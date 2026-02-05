/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Info, Keyboard, Github, ExternalLink, Sparkles, ChevronDown, Zap, Wrench, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts';

const GITHUB_URL = 'https://github.com/louistrue/ifc-lite';
const INITIAL_RELEASE_COUNT = 5;

interface InfoDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatBuildDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

const TYPE_CONFIG = {
  feature: { icon: Plus, className: 'text-emerald-500' },
  fix: { icon: Wrench, className: 'text-amber-500' },
  perf: { icon: Zap, className: 'text-blue-500' },
} as const;

function AboutTab() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center pb-4 border-b">
        <h3 className="text-xl font-bold">ifc-lite</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Version {__APP_VERSION__}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Built {formatBuildDate(__BUILD_DATE__)}
        </p>
      </div>

      {/* Description */}
      <div className="space-y-2">
        <p className="text-sm">
          A high-performance IFC viewer for BIM models, built with WebGPU.
        </p>
      </div>

      {/* Features */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Features</h4>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>WebGPU-accelerated 3D rendering</li>
          <li>IFC4 and IFC5/IFCX format support</li>
          <li>Multi-model federation</li>
          <li>Spatial hierarchy navigation</li>
          <li>Section planes and measurements</li>
          <li>Property inspection</li>
        </ul>
      </div>

      {/* Links */}
      <div className="pt-4 border-t space-y-2">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Github className="h-4 w-4" />
          <span>View on GitHub</span>
          <ExternalLink className="h-3 w-3" />
        </a>
        <a
          href={`${GITHUB_URL}/issues`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="w-4 text-center">🐛</span>
          <span>Report an issue</span>
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* License */}
      <div className="pt-4 border-t">
        <p className="text-xs text-muted-foreground text-center">
          Licensed under Mozilla Public License 2.0
        </p>
      </div>
    </div>
  );
}

function WhatsNewTab() {
  const [showAll, setShowAll] = useState(false);
  const releases = __RELEASE_HISTORY__;

  const visibleReleases = useMemo(
    () => (showAll ? releases : releases.slice(0, INITIAL_RELEASE_COUNT)),
    [releases, showAll]
  );

  const hasMore = releases.length > INITIAL_RELEASE_COUNT;

  if (releases.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No release history available.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleReleases.map((release, i) => (
        <div key={release.version}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-sm font-semibold">v{release.version}</span>
            {i === 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded">
                latest
              </span>
            )}
          </div>
          <ul className="space-y-1 ml-0.5">
            {release.highlights.map((h) => {
              const { icon: Icon, className } = TYPE_CONFIG[h.type];
              return (
                <li key={h.text} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${className}`} />
                  <span>{h.text}</span>
                </li>
              );
            })}
          </ul>
          {i < visibleReleases.length - 1 && (
            <div className="border-b mt-3" />
          )}
        </div>
      ))}

      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          Show all {releases.length} releases
        </button>
      )}

      {/* Legend */}
      <div className="pt-3 border-t flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Plus className="h-3 w-3 text-emerald-500" /> Feature
        </span>
        <span className="flex items-center gap-1">
          <Wrench className="h-3 w-3 text-amber-500" /> Fix
        </span>
        <span className="flex items-center gap-1">
          <Zap className="h-3 w-3 text-blue-500" /> Perf
        </span>
      </div>
    </div>
  );
}

function ShortcutsTab() {
  // Group shortcuts by category
  const grouped = KEYBOARD_SHORTCUTS.reduce(
    (acc, shortcut) => {
      if (!acc[shortcut.category]) {
        acc[shortcut.category] = [];
      }
      acc[shortcut.category].push(shortcut);
      return acc;
    },
    {} as Record<string, (typeof KEYBOARD_SHORTCUTS)[number][]>
  );

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([category, shortcuts]) => (
        <div key={category}>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">
            {category}
          </h3>
          <div className="space-y-1">
            {shortcuts.map((shortcut) => (
              <div
                key={shortcut.key + shortcut.description}
                className="flex items-center justify-between py-1"
              >
                <span className="text-sm">{shortcut.description}</span>
                <kbd className="px-2 py-0.5 text-xs bg-muted rounded border font-mono">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function KeyboardShortcutsDialog({ open, onClose }: InfoDialogProps) {
  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border rounded-lg shadow-xl w-full max-w-md m-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Info</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabbed Content */}
        <Tabs defaultValue="about" className="w-full">
          <div className="px-4 pt-4">
            <TabsList className="w-full">
              <TabsTrigger value="about" className="flex-1 gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Info className="h-3.5 w-3.5" />
                About
              </TabsTrigger>
              <TabsTrigger value="whatsnew" className="flex-1 gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                What's New
              </TabsTrigger>
              <TabsTrigger value="shortcuts" className="flex-1 gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Keyboard className="h-3.5 w-3.5" />
                Shortcuts
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="about" className="p-4 max-h-80 overflow-y-auto">
            <AboutTab />
          </TabsContent>

          <TabsContent value="whatsnew" className="p-4 max-h-96 overflow-y-auto">
            <WhatsNewTab />
          </TabsContent>

          <TabsContent value="shortcuts" className="p-4 max-h-80 overflow-y-auto">
            <ShortcutsTab />
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="p-4 border-t text-center">
          <span className="text-xs text-muted-foreground">
            Press{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded border font-mono text-xs">
              ?
            </kbd>{' '}
            to toggle this panel
          </span>
        </div>
      </div>
    </div>
  );
}

// Hook to manage info dialog state (renamed export for backward compatibility)
export function useKeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

  // Listen for '?' key to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggle]);

  return { open, toggle, close };
}
