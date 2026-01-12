import { useRef, useCallback } from 'react';
import {
  FolderOpen,
  Download,
  MousePointer2,
  Hand,
  Rotate3d,
  PersonStanding,
  Ruler,
  Scissors,
  Eye,
  EyeOff,
  Focus,
  Home,
  Maximize2,
  Grid3x3,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Box,
  Sun,
  Moon,
  HelpCircle,
  Loader2,
  Camera,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { useViewerStore } from '@/store';
import { useIfc } from '@/hooks/useIfc';
import { cn } from '@/lib/utils';
import { GLTFExporter } from '@ifc-lite/export';

type Tool = 'select' | 'pan' | 'orbit' | 'walk' | 'measure' | 'section';

export function MainToolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadFile, loading, progress, geometryResult } = useIfc();
  const activeTool = useViewerStore((state) => state.activeTool);
  const setActiveTool = useViewerStore((state) => state.setActiveTool);
  const theme = useViewerStore((state) => state.theme);
  const toggleTheme = useViewerStore((state) => state.toggleTheme);
  const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
  const isolateEntity = useViewerStore((state) => state.isolateEntity);
  const hideEntity = useViewerStore((state) => state.hideEntity);
  const showAll = useViewerStore((state) => state.showAll);
  const error = useViewerStore((state) => state.error);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadFile(file);
    }
  }, [loadFile]);

  const handleIsolate = useCallback(() => {
    if (selectedEntityId) {
      isolateEntity(selectedEntityId);
    }
  }, [selectedEntityId, isolateEntity]);

  const handleHide = useCallback(() => {
    if (selectedEntityId) {
      hideEntity(selectedEntityId);
    }
  }, [selectedEntityId, hideEntity]);

  const handleExportGLB = useCallback(() => {
    if (!geometryResult) return;
    try {
      const exporter = new GLTFExporter(geometryResult);
      const glb = exporter.exportGLB({ includeMetadata: true });
      // Create a new Uint8Array from the buffer to ensure correct typing
      const blob = new Blob([new Uint8Array(glb)], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.glb';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [geometryResult]);

  const handleScreenshot = useCallback(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'screenshot.png';
      a.click();
    } catch (err) {
      console.error('Screenshot failed:', err);
    }
  }, []);

  const ToolButton = ({
    tool,
    icon: Icon,
    label,
    shortcut
  }: {
    tool: Tool;
    icon: React.ElementType;
    label: string;
    shortcut?: string;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={activeTool === tool ? 'default' : 'ghost'}
          size="icon-sm"
          onClick={() => setActiveTool(tool)}
          className={cn(activeTool === tool && 'bg-primary text-primary-foreground')}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {shortcut && <span className="ml-2 text-xs opacity-60">({shortcut})</span>}
      </TooltipContent>
    </Tooltip>
  );

  const ActionButton = ({
    icon: Icon,
    label,
    onClick,
    shortcut,
    disabled
  }: {
    icon: React.ElementType;
    label: string;
    onClick: () => void;
    shortcut?: string;
    disabled?: boolean;
  }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} {shortcut && <span className="ml-2 text-xs opacity-60">({shortcut})</span>}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex items-center gap-1 px-2 h-12 border-b bg-card">
      {/* File Operations */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".ifc"
        onChange={handleFileSelect}
        className="hidden"
      />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open IFC File</TooltipContent>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" disabled={!geometryResult}>
            <Download className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleExportGLB}>
            <Download className="h-4 w-4 mr-2" />
            Export GLB
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleScreenshot}>
            <Camera className="h-4 w-4 mr-2" />
            Screenshot
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Navigation Tools */}
      <ToolButton tool="select" icon={MousePointer2} label="Select" shortcut="V" />
      <ToolButton tool="pan" icon={Hand} label="Pan" shortcut="H" />
      <ToolButton tool="orbit" icon={Rotate3d} label="Orbit" shortcut="O" />
      <ToolButton tool="walk" icon={PersonStanding} label="Walk Mode" shortcut="C" />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Measurement & Section */}
      <ToolButton tool="measure" icon={Ruler} label="Measure" shortcut="M" />
      <ToolButton tool="section" icon={Scissors} label="Section" shortcut="X" />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Visibility */}
      <ActionButton icon={Focus} label="Isolate Selection" onClick={handleIsolate} shortcut="I" disabled={!selectedEntityId} />
      <ActionButton icon={EyeOff} label="Hide Selection" onClick={handleHide} shortcut="H" disabled={!selectedEntityId} />
      <ActionButton icon={Eye} label="Show All" onClick={showAll} shortcut="A" />

      <Separator orientation="vertical" className="h-6 mx-1" />

      {/* Camera */}
      <ActionButton icon={Home} label="Fit All" onClick={() => {}} shortcut="F" />
      <ActionButton icon={Maximize2} label="Zoom to Selection" onClick={() => {}} shortcut="Z" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <Grid3x3 className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            <ArrowUp className="h-4 w-4 mr-2" /> Top <span className="ml-auto text-xs opacity-60">1</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ArrowDown className="h-4 w-4 mr-2" /> Bottom <span className="ml-auto text-xs opacity-60">2</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ArrowRight className="h-4 w-4 mr-2" /> Front <span className="ml-auto text-xs opacity-60">3</span>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back <span className="ml-auto text-xs opacity-60">4</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Box className="h-4 w-4 mr-2" /> Isometric <span className="ml-auto text-xs opacity-60">0</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Loading Progress */}
      {loading && progress && (
        <div className="flex items-center gap-2 mr-4">
          <span className="text-xs text-muted-foreground">{progress.phase}</span>
          <Progress value={progress.percent} className="w-32 h-2" />
          <span className="text-xs text-muted-foreground">{Math.round(progress.percent)}%</span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <span className="text-xs text-destructive mr-4">{error}</span>
      )}

      {/* Right Side Actions */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle Theme</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <HelpCircle className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Keyboard Shortcuts</TooltipContent>
      </Tooltip>
    </div>
  );
}
