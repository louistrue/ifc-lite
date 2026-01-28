/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useState, useEffect, useCallback } from 'react';
import { X, Info, Keyboard, Github, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { KEYBOARD_SHORTCUTS } from '@/hooks/useKeyboardShortcuts';

const VERSION = '1.3.0';
const GITHUB_URL = 'https://github.com/louistrue/ifc-lite';

interface InfoDialogProps {
  open: boolean;
  onClose: () => void;
}

function AboutTab() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center pb-4 border-b">
        <h3 className="text-xl font-bold">ifc-lite</h3>
        <p className="text-sm text-muted-foreground mt-1">Version {VERSION}</p>
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
              <TabsTrigger value="shortcuts" className="flex-1 gap-1.5 data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Keyboard className="h-3.5 w-3.5" />
                Shortcuts
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="about" className="p-4 max-h-80 overflow-y-auto">
            <AboutTab />
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
