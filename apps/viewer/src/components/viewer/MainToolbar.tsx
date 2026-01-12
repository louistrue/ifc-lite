import { useRef, useCallback, useState } from 'react';
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

type Tool = 'select' | 'pan' | 'orbit' | 'walk' | 'measure' | 'section';

export function MainToolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadFile, loading, progress, geometryResult } = useIfc();
  const [activeTool, setActiveTool] = useState<Tool>('select');
  const [darkMode, setDarkMode] = useState(false);
  const error = useViewerStore((state) => state.error);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      loadFile(file);
    }
  }, [loadFile]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode(!darkMode);
    document.documentElement.classList.toggle('dark');
  }, [darkMode]);

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
          <DropdownMenuItem>Export GLB</DropdownMenuItem>
          <DropdownMenuItem>Export BOS</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Screenshot</DropdownMenuItem>
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
      <ActionButton icon={Focus} label="Isolate Selection" onClick={() => {}} shortcut="I" />
      <ActionButton icon={EyeOff} label="Hide Selection" onClick={() => {}} shortcut="H" />
      <ActionButton icon={Eye} label="Show All" onClick={() => {}} shortcut="A" />

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
          <Button variant="ghost" size="icon-sm" onClick={toggleDarkMode}>
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Toggle Dark Mode</TooltipContent>
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
