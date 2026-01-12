import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MainToolbar } from './MainToolbar';
import { HierarchyPanel } from './HierarchyPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { StatusBar } from './StatusBar';
import { ViewportContainer } from './ViewportContainer';

export function ViewerLayout() {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
        {/* Main Toolbar */}
        <MainToolbar />

        {/* Main Content Area */}
        <PanelGroup orientation="horizontal" className="flex-1 min-h-0">
          {/* Left Panel - Hierarchy */}
          <Panel
            id="left-panel"
            defaultSize={20}
            minSize={10}
            maxSize={40}
            collapsible
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
            maxSize={40}
            collapsible
          >
            <div className="h-full w-full overflow-hidden">
              <PropertiesPanel />
            </div>
          </Panel>
        </PanelGroup>

        {/* Status Bar */}
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}
