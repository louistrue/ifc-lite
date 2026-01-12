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
      <div className="flex flex-col h-screen bg-background text-foreground">
        {/* Main Toolbar */}
        <MainToolbar />

        {/* Main Content Area */}
        <PanelGroup orientation="horizontal" className="flex-1">
          {/* Left Panel - Hierarchy */}
          <Panel
            id="left-panel"
            defaultSize={20}
            minSize={15}
            maxSize={35}
            collapsible
            collapsedSize={0}
          >
            <HierarchyPanel />
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

          {/* Center - Viewport */}
          <Panel id="viewport-panel" defaultSize={60} minSize={30}>
            <ViewportContainer />
          </Panel>

          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

          {/* Right Panel - Properties */}
          <Panel
            id="right-panel"
            defaultSize={20}
            minSize={15}
            maxSize={35}
            collapsible
            collapsedSize={0}
          >
            <PropertiesPanel />
          </Panel>
        </PanelGroup>

        {/* Status Bar */}
        <StatusBar />
      </div>
    </TooltipProvider>
  );
}
