/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Info, Keyboard, Github, ExternalLink, Sparkles, ChevronDown, ChevronRight, Zap, Wrench, Plus, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts';

const GITHUB_URL = 'https://github.com/louistrue/ifc-lite';

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
  const [showPackages, setShowPackages] = useState(false);
  const packageVersions = __PACKAGE_VERSIONS__;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="text-center pb-2 border-b">
        <h3 className="text-xl font-bold">ifc-lite</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          v{__APP_VERSION__} &middot; {formatBuildDate(__BUILD_DATE__)}
        </p>
      </div>

      {/* Links */}
      <div className="flex items-center justify-center gap-4 text-xs">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Github className="h-3.5 w-3.5" />
          GitHub
        </a>
        <a
          href={`${GITHUB_URL}/issues`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          Report issue
          <ExternalLink className="h-3 w-3" />
        </a>
        <span className="text-muted-foreground">MPL-2.0</span>
      </div>

      {/* Feature chips */}
      <div className="flex flex-wrap gap-1 justify-center pt-2 border-t">
        {[
          'WebGPU', 'IFC2x3', 'IFC4', 'IFC4X3', 'IFC5/IFCX',
          'Federation', 'Measurements', 'Sections',
          'Properties', 'Data tables', 'Lens rules', 'IDS',
          '2D drawings', 'BCF', 'Scripting', 'AI assistant',
          'glTF export', 'CSV', 'Parquet',
        ].map((tag) => (
          <span
            key={tag}
            className="px-2 py-0.5 text-[11px] rounded-full bg-muted/60 text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Package Versions */}
      {packageVersions.length > 0 && (
        <div className="pt-2 border-t">
          <button
            onClick={() => setShowPackages(!showPackages)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPackages ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <Package className="h-3 w-3" />
            {packageVersions.length} packages
          </button>
          {showPackages && (
            <div className="rounded-md border bg-muted/30 p-2 mt-1.5 max-h-48 overflow-y-auto">
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                {packageVersions.map((pkg) => (
                  <div
                    key={pkg.name}
                    className="flex items-center justify-between text-xs py-0.5 px-1 min-w-0"
                  >
                    <span className="text-muted-foreground font-mono truncate mr-2">
                      {pkg.name.replace('@ifc-lite/', '')}
                    </span>
                    <span className="font-mono shrink-0 tabular-nums">{pkg.version}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatPkgName(name: string): string {
  return name.replace('@ifc-lite/', '');
}

type TimelineEntry = {
  version: string;
  isViewerVersion: boolean;
  entries: Array<{ pkg: string; highlights: typeof __RELEASE_HISTORY__[0]['releases'][0]['highlights'] }>;
};

const compareSemver = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
  }
  return 0;
};

/** Merge all per-package changelogs into a unified timeline grouped by version. */
function buildTimeline(
  packageChangelogs: typeof __RELEASE_HISTORY__,
  viewerVersion: string
): TimelineEntry[] {
  type Highlights = typeof __RELEASE_HISTORY__[0]['releases'][0]['highlights'];
  const versionMap = new Map<string, Map<string, Highlights>>();

  for (const pkg of packageChangelogs) {
    for (const release of pkg.releases) {
      if (!versionMap.has(release.version)) {
        versionMap.set(release.version, new Map());
      }
      versionMap.get(release.version)!.set(pkg.name, release.highlights);
    }
  }

  return Array.from(versionMap.entries())
    .sort(([a], [b]) => compareSemver(a, b))
    .map(([version, pkgMap]) => ({
      version,
      isViewerVersion: version === viewerVersion,
      entries: Array.from(pkgMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pkg, highlights]) => ({ pkg, highlights })),
    }));
}

function WhatsNewTab() {
  const packageChangelogs = __RELEASE_HISTORY__;
  const viewerVersion = __APP_VERSION__;
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(() => new Set());

  const timeline = useMemo(
    () => buildTimeline(packageChangelogs, viewerVersion),
    [packageChangelogs, viewerVersion]
  );

  // Auto-expand the first version with actual changes
  useEffect(() => {
    if (timeline.length > 0 && expandedVersions.size === 0) {
      setExpandedVersions(new Set([timeline[0].version]));
    }
  }, [timeline]);

  const toggleVersion = useCallback((version: string) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }, []);

  if (timeline.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        No release history available.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {timeline.map((release) => {
        const isExpanded = expandedVersions.has(release.version);
        const totalHighlights = release.entries.reduce((s, e) => s + e.highlights.length, 0);
        return (
          <div key={release.version}>
            <button
              onClick={() => toggleVersion(release.version)}
              className="flex items-center gap-2 w-full py-1.5 px-1 text-left hover:bg-muted/40 transition-colors rounded"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold">v{release.version}</span>
              {release.isViewerVersion && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-sky-500/15 text-sky-600 dark:text-sky-400 rounded">
                  viewer
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {totalHighlights} change{totalHighlights !== 1 ? 's' : ''}
              </span>
            </button>
            {isExpanded && (
              <div className="ml-5 pb-2 space-y-2">
                {release.entries.map(({ pkg, highlights }) => (
                  <div key={pkg}>
                    <span className="text-xs font-medium font-mono text-muted-foreground">
                      {formatPkgName(pkg)}
                    </span>
                    <ul className="space-y-0.5 mt-0.5">
                      {highlights.map((h) => {
                        const { icon: Icon, className } = TYPE_CONFIG[h.type];
                        return (
                          <li
                            key={h.text}
                            className="flex items-start gap-1.5 text-sm text-muted-foreground"
                          >
                            <Icon className={`h-3 w-3 mt-0.5 shrink-0 ${className}`} />
                            <span>{h.text}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

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
      // Ignore if typing in an input or textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }
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
