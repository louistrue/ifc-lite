/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect } from 'react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MainToolbar } from './MainToolbar';
import { HierarchyPanel } from './HierarchyPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { StatusBar } from './StatusBar';
import { ViewportContainer } from './ViewportContainer';
import { KeyboardShortcutsDialog, useKeyboardShortcutsDialog } from './KeyboardShortcutsDialog';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useViewerStore } from '@/store';
import { EntityContextMenu } from './EntityContextMenu';
import { HoverTooltip } from './HoverTooltip';

export function ViewerLayout() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();
  const shortcutsDialog = useKeyboardShortcutsDialog();

  // Initialize theme on mount
  const theme = useViewerStore((s) => s.theme);
  const isMobile = useViewerStore((s) => s.isMobile);
  const setIsMobile = useViewerStore((s) => s.setIsMobile);
  const leftPanelCollapsed = useViewerStore((s) => s.leftPanelCollapsed);
  const rightPanelCollapsed = useViewerStore((s) => s.rightPanelCollapsed);
  const setLeftPanelCollapsed = useViewerStore((s) => s.setLeftPanelCollapsed);
  const setRightPanelCollapsed = useViewerStore((s) => s.setRightPanelCollapsed);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      // Auto-collapse panels on mobile
      if (mobile) {
        setLeftPanelCollapsed(true);
        setRightPanelCollapsed(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setIsMobile, setLeftPanelCollapsed, setRightPanelCollapsed]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* Keyboard Shortcuts Dialog */}
        <KeyboardShortcutsDialog open={shortcutsDialog.open} onClose={shortcutsDialog.close} />

        {/* Global Overlays */}
        <EntityContextMenu />
        <HoverTooltip />

        {/* Main Toolbar */}
        <MainToolbar onShowShortcuts={shortcutsDialog.toggle} />

        {/* Main Content Area - Desktop Layout */}
        {!isMobile && (
          <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
            {/* Left Panel - Hierarchy */}
            <Panel
              id="left-panel"
              defaultSize={20}
              minSize={10}
              collapsible
              collapsedSize={0}
            >
              <div className="h-full w-full overflow-hidden">
                <HierarchyPanel />
              </div>
            </Panel>

            <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

            {/* Center - Viewport */}
            <Panel id="viewport-panel" defaultSize={60} minSize={30}>
              <div className="h-full w-full overflow-hidden">
                <ViewportContainer />
              </div>
            </Panel>

            <PanelResizeHandle className="w-1.5 bg-border hover:bg-primary/50 active:bg-primary/70 transition-colors cursor-col-resize" />

            {/* Right Panel - Properties */}
            <Panel
              id="right-panel"
              defaultSize={20}
              minSize={10}
              collapsible
              collapsedSize={0}
            >
              <div className="h-full w-full overflow-hidden">
                <PropertiesPanel />
              </div>
            </Panel>
          </PanelGroup>
        )}

        {/* Main Content Area - Mobile Layout */}
        {isMobile && (
          <div className="flex-1 min-h-0 relative">
            {/* Full-screen Viewport */}
            <div className="h-full w-full">
              <ViewportContainer />
            </div>

            {/* Mobile Bottom Sheet - Hierarchy */}
            {!leftPanelCollapsed && (
              <div className="absolute inset-x-0 bottom-0 h-[50vh] bg-background border-t rounded-t-xl shadow-xl z-40 animate-in slide-in-from-bottom">
                <div className="flex items-center justify-between p-2 border-b">
                  <span className="font-medium text-sm">Hierarchy</span>
                  <button
                    className="p-1 hover:bg-muted rounded"
                    onClick={() => setLeftPanelCollapsed(true)}
                  >
                    <span className="sr-only">Close</span>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="h-[calc(50vh-48px)] overflow-auto">
                  <HierarchyPanel />
                </div>
              </div>
            )}

            {/* Mobile Bottom Sheet - Properties */}
            {!rightPanelCollapsed && (
              <div className="absolute inset-x-0 bottom-0 h-[50vh] bg-background border-t rounded-t-xl shadow-xl z-40 animate-in slide-in-from-bottom">
                <div className="flex items-center justify-between p-2 border-b">
                  <span className="font-medium text-sm">Properties</span>
                  <button
                    className="p-1 hover:bg-muted rounded"
                    onClick={() => setRightPanelCollapsed(true)}
                  >
                    <span className="sr-only">Close</span>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="h-[calc(50vh-48px)] overflow-auto">
                  <PropertiesPanel />
                </div>
              </div>
            )}

            {/* Mobile Action Buttons */}
            <div className="absolute bottom-4 left-4 right-4 flex justify-center gap-2 z-30">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg text-sm font-medium"
                onClick={() => {
                  setRightPanelCollapsed(true);
                  setLeftPanelCollapsed(!leftPanelCollapsed);
                }}
              >
                Hierarchy
              </button>
              <button
                className="px-4 py-2 bg-primary text-primary-foreground rounded-full shadow-lg text-sm font-medium"
                onClick={() => {
                  setLeftPanelCollapsed(true);
                  setRightPanelCollapsed(!rightPanelCollapsed);
                }}
              >
                Properties
              </button>
            </div>
          </div>
        )}

        {/* Status Bar */}
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}
