# IFC-Lite Viewer: UI/UX Overhaul Plan

## Vision: From Basic to Stunning

Transform the current functional but basic viewer into **a world-class IFC viewing experience** that rivals professional desktop applications while maintaining the speed and accessibility of a web application.

---

## Current State Analysis

### What Works
- WebGPU rendering pipeline (functional)
- Camera controls (orbit, pan, zoom, touch)
- Object picking and selection
- Property display with spatial location
- Storey filtering
- Export functionality (GLB, BOS)
- Keyboard shortcuts (preset views, first-person mode)

### What's Missing for Exceptional UX
| Area | Current State | Target State |
|------|---------------|--------------|
| Design System | Inline styles, no consistency | Modern design system (Tailwind + shadcn/ui) |
| Layout | Fixed 320px right panel | Resizable, collapsible panels |
| Toolbar | Basic file/export buttons | Full tool palette with icons |
| Hierarchy | Storey list only | Full spatial tree with search |
| Selection | No visual feedback | Glow, outline, transparency modes |
| Tools | None | Measure, Section, Annotations |
| Navigation | Basic controls | ViewCube, preset buttons, minimap |
| Status | None | Stats bar, performance metrics |
| Loading | Simple progress bar | Skeleton UI, progressive reveal |
| Accessibility | None | Full keyboard nav, ARIA labels |
| Mobile | Touch works | Responsive layout, touch gestures |

---

## Design Philosophy

### Core Principles

1. **Progressive Disclosure** - Show simple interface first, reveal complexity on demand
2. **Spatial Awareness** - Always show user where they are in the model
3. **Instant Feedback** - Every action has immediate visual response
4. **Keyboard First** - Power users can do everything with keyboard
5. **Touch Native** - Not just "works on mobile" but "designed for touch"
6. **Performance Perception** - Feel fast even when loading

---

## Phase 1: Design System Foundation

### 1.1 Technology Stack

```
UI Framework:     React 19 (existing)
Styling:          Tailwind CSS 4.0 + CSS Variables for theming
Components:       shadcn/ui (Radix UI primitives)
Icons:            Lucide React (consistent, MIT licensed)
State:            Zustand (existing) + Immer for complex updates
Animations:       Framer Motion (for meaningful motion)
Layouts:          react-resizable-panels (for resizable layouts)
Virtualization:   @tanstack/react-virtual (for large lists)
```

### 1.2 Color System

```css
/* Light Theme */
--background: 250 250 250;        /* Off-white */
--foreground: 23 23 23;           /* Near-black */
--primary: 59 130 246;            /* Blue-500 */
--primary-hover: 37 99 235;       /* Blue-600 */
--secondary: 100 116 139;         /* Slate-500 */
--accent: 16 185 129;             /* Emerald-500 */
--destructive: 239 68 68;         /* Red-500 */
--muted: 241 245 249;             /* Slate-100 */
--border: 226 232 240;            /* Slate-200 */

/* Selection Colors */
--selection-primary: 59 130 246 / 0.5;    /* Selected object */
--selection-hover: 59 130 246 / 0.2;      /* Hovered object */
--selection-isolated: 0 0 0 / 0.7;        /* Non-isolated objects */

/* Dark Theme */
--background-dark: 23 23 23;
--foreground-dark: 250 250 250;
/* ... */
```

### 1.3 Component Library

```
/components
  /ui                 # shadcn/ui base components
    Button.tsx
    Input.tsx
    Tooltip.tsx
    DropdownMenu.tsx
    Popover.tsx
    Slider.tsx
    Toggle.tsx
    Tabs.tsx
    Collapsible.tsx
    ScrollArea.tsx
    Separator.tsx

  /viewer             # Viewer-specific components
    /toolbar
    /panels
    /viewport
    /overlays
    /dialogs
```

---

## Phase 2: Layout Architecture

### 2.1 Main Layout Structure

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR (48px)                                                           │
│  [☰] IFC-Lite Viewer    [File ▼] [View ▼] [Tools ▼]        [⚙] [?] [Theme] │
├──────────────────────────────────────────────────────────────────────────────┤
│  TOOLBAR (44px)                                                              │
│  [Select] [Pan] [Orbit] | [Measure] [Section] [Annotate] | [Home] [Views ▼] │
├───────────────┬──────────────────────────────────────────┬───────────────────┤
│ LEFT PANEL    │           3D VIEWPORT                    │   RIGHT PANEL     │
│ (280px)       │                                          │   (320px)         │
│ ═══════════   │                              ┌─────────┐│   ═══════════════  │
│               │                              │ViewCube ││                    │
│ [Search 🔍]   │                              └─────────┘│   [Properties]     │
│               │                                          │   [Spatial]       │
│ ▼ Project     │                                          │   [Quantities]    │
│   ▼ Site      │                                          │   ───────────────  │
│     ▼ Bldg    │                                          │                    │
│       ▼ L00   │                                          │   Entity #12345    │
│         Wall  │                                          │   Type: IfcWall    │
│         Door  │           [MODEL HERE]                   │   Name: Wall-001   │
│         ...   │                                          │                    │
│       ▼ L01   │                                          │   ▸ Pset_WallComm  │
│         ...   │                                          │   ▸ Qto_WallBase   │
│               │                                          │                    │
│               │                              [Scale Bar] │                    │
│               │   [Context: Storey L00 - 45,231 visible] │                    │
├───────────────┴──────────────────────────────────────────┴───────────────────┤
│  STATUS BAR (28px)                                                           │
│  Ready │ 45,231 elements │ 2.3M tris │ 60 FPS │ 847 MB │ [GPU: WebGPU ✓]    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Panel System

```typescript
interface PanelConfig {
  id: string;
  title: string;
  icon: LucideIcon;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapsible: boolean;
  defaultCollapsed: boolean;
  position: 'left' | 'right' | 'bottom';
  tabs?: TabConfig[];
}

const DEFAULT_PANELS: PanelConfig[] = [
  {
    id: 'hierarchy',
    title: 'Model',
    icon: Layers,
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: 450,
    collapsible: true,
    defaultCollapsed: false,
    position: 'left',
  },
  {
    id: 'properties',
    title: 'Properties',
    icon: Info,
    defaultWidth: 320,
    minWidth: 250,
    maxWidth: 500,
    collapsible: true,
    defaultCollapsed: false,
    position: 'right',
    tabs: [
      { id: 'properties', label: 'Properties', icon: FileText },
      { id: 'spatial', label: 'Spatial', icon: Building2 },
      { id: 'quantities', label: 'Quantities', icon: Calculator },
    ],
  },
];
```

### 2.3 Responsive Breakpoints

```typescript
const BREAKPOINTS = {
  mobile: 640,      // Single panel mode, bottom sheet
  tablet: 1024,     // Collapsible panels, touch optimized
  desktop: 1280,    // Full layout
  wide: 1920,       // Extra space for additional panels
};

// Mobile Layout
// - Viewport full screen
// - Panels as bottom sheets (swipe up)
// - Floating toolbar (bottom)

// Tablet Layout
// - Viewport with collapsible side panels
// - Panels overlay viewport when open

// Desktop Layout
// - Full 3-column layout
// - Resizable panels
```

---

## Phase 3: Toolbar & Tools

### 3.1 Toolbar Design

```typescript
interface ToolGroup {
  id: string;
  tools: Tool[];
  separator?: boolean;
}

interface Tool {
  id: string;
  name: string;
  icon: LucideIcon;
  shortcut?: string;
  mode?: 'toggle' | 'action' | 'dropdown';
  subTools?: Tool[];
  tooltip: string;
}

const TOOLBAR_CONFIG: ToolGroup[] = [
  {
    id: 'navigation',
    tools: [
      { id: 'select', name: 'Select', icon: MousePointer2, shortcut: 'V', mode: 'toggle', tooltip: 'Select objects (V)' },
      { id: 'pan', name: 'Pan', icon: Hand, shortcut: 'H', mode: 'toggle', tooltip: 'Pan view (H)' },
      { id: 'orbit', name: 'Orbit', icon: Rotate3d, shortcut: 'O', mode: 'toggle', tooltip: 'Orbit view (O)' },
      { id: 'firstPerson', name: 'Walk', icon: PersonStanding, shortcut: 'C', mode: 'toggle', tooltip: 'First-person mode (C)' },
    ],
    separator: true,
  },
  {
    id: 'measurement',
    tools: [
      {
        id: 'measure',
        name: 'Measure',
        icon: Ruler,
        shortcut: 'M',
        mode: 'dropdown',
        tooltip: 'Measurement tools',
        subTools: [
          { id: 'measureDistance', name: 'Distance', icon: ArrowLeftRight, tooltip: 'Measure distance between points' },
          { id: 'measureAngle', name: 'Angle', icon: Triangle, tooltip: 'Measure angle' },
          { id: 'measureArea', name: 'Area', icon: Square, tooltip: 'Measure area' },
          { id: 'measureHeight', name: 'Height', icon: ArrowUpDown, tooltip: 'Measure vertical distance' },
        ],
      },
    ],
  },
  {
    id: 'section',
    tools: [
      {
        id: 'section',
        name: 'Section',
        icon: Scissors,
        shortcut: 'X',
        mode: 'dropdown',
        tooltip: 'Section plane tools',
        subTools: [
          { id: 'sectionX', name: 'Section X', icon: ArrowRightLeft, tooltip: 'Add X-axis section plane' },
          { id: 'sectionY', name: 'Section Y', icon: ArrowUpDown, tooltip: 'Add Y-axis section plane' },
          { id: 'sectionZ', name: 'Section Z', icon: Layers, tooltip: 'Add Z-axis section plane' },
          { id: 'sectionFree', name: 'Free Section', icon: Slice, tooltip: 'Add free section plane' },
        ],
      },
    ],
  },
  {
    id: 'visibility',
    tools: [
      { id: 'isolate', name: 'Isolate', icon: Focus, shortcut: 'I', mode: 'action', tooltip: 'Isolate selection (I)' },
      { id: 'hide', name: 'Hide', icon: EyeOff, shortcut: 'H', mode: 'action', tooltip: 'Hide selection (H)' },
      { id: 'showAll', name: 'Show All', icon: Eye, shortcut: 'A', mode: 'action', tooltip: 'Show all (A)' },
    ],
    separator: true,
  },
  {
    id: 'camera',
    tools: [
      { id: 'home', name: 'Home', icon: Home, shortcut: 'F', mode: 'action', tooltip: 'Fit all (F)' },
      { id: 'zoomSelection', name: 'Zoom Selection', icon: Maximize2, shortcut: 'Z', mode: 'action', tooltip: 'Zoom to selection (Z)' },
      {
        id: 'views',
        name: 'Views',
        icon: Grid3x3,
        mode: 'dropdown',
        tooltip: 'Preset views',
        subTools: [
          { id: 'viewTop', name: 'Top', icon: ArrowUp, shortcut: '1', tooltip: 'Top view (1)' },
          { id: 'viewBottom', name: 'Bottom', icon: ArrowDown, shortcut: '2', tooltip: 'Bottom view (2)' },
          { id: 'viewFront', name: 'Front', icon: ArrowRight, shortcut: '3', tooltip: 'Front view (3)' },
          { id: 'viewBack', name: 'Back', icon: ArrowLeft, shortcut: '4', tooltip: 'Back view (4)' },
          { id: 'viewLeft', name: 'Left', icon: ArrowLeftCircle, shortcut: '5', tooltip: 'Left view (5)' },
          { id: 'viewRight', name: 'Right', icon: ArrowRightCircle, shortcut: '6', tooltip: 'Right view (6)' },
          { id: 'viewIsometric', name: 'Isometric', icon: Box, shortcut: '0', tooltip: 'Isometric view (0)' },
        ],
      },
    ],
  },
];
```

### 3.2 Tool Implementation Priority

| Tool | Priority | Complexity | Impact |
|------|----------|------------|--------|
| Select | P0 | Low | High |
| Pan/Orbit/Zoom | P0 | Done | High |
| Home/Fit | P0 | Done | High |
| Preset Views | P0 | Done | Medium |
| Isolate/Hide/Show | P1 | Medium | High |
| Distance Measure | P1 | Medium | High |
| Section Planes | P1 | High | High |
| Angle Measure | P2 | Medium | Medium |
| Area Measure | P2 | Medium | Medium |
| Annotations | P3 | High | Medium |
| First Person | P2 | Done | Medium |

---

## Phase 4: Hierarchy Panel

### 4.1 Tree Component

```typescript
interface TreeNode {
  id: number;
  name: string;
  type: IfcType;
  icon: LucideIcon;
  children?: TreeNode[];
  elementCount?: number;
  isExpanded?: boolean;
  isVisible?: boolean;
  isSelected?: boolean;
  isFiltered?: boolean;
}

// Virtual scrolling for 100K+ nodes
const HierarchyTree: React.FC = () => {
  const [expandedNodes, setExpandedNodes] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');

  // Flatten tree for virtual scrolling
  const flatNodes = useMemo(() =>
    flattenTree(treeData, expandedNodes, filter),
    [treeData, expandedNodes, filter]
  );

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    estimateSize: () => 32,
    overscan: 20,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b">
        <Input
          placeholder="Search elements..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = flatNodes[virtualRow.index];
            return (
              <TreeNodeRow
                key={node.id}
                node={node}
                style={{
                  position: 'absolute',
                  top: virtualRow.start,
                  height: virtualRow.size,
                }}
                onToggle={() => toggleNode(node.id)}
                onSelect={() => selectNode(node.id)}
                onContextMenu={(e) => showContextMenu(e, node)}
              />
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
};
```

### 4.2 Tree Node Design

```tsx
const TreeNodeRow: React.FC<TreeNodeRowProps> = ({ node, style, depth }) => {
  const IconComponent = getIconForType(node.type);

  return (
    <div
      style={style}
      className={cn(
        "flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-muted",
        "border-l-2 border-transparent",
        node.isSelected && "bg-primary/10 border-l-primary",
        node.isFiltered && "opacity-50",
        !node.isVisible && "line-through opacity-30"
      )}
    >
      {/* Indent */}
      <div style={{ width: depth * 16 }} />

      {/* Expand/Collapse */}
      {node.children?.length > 0 ? (
        <button onClick={() => toggleExpand(node.id)}>
          <ChevronRight className={cn(
            "w-4 h-4 transition-transform",
            node.isExpanded && "rotate-90"
          )} />
        </button>
      ) : (
        <div className="w-4" />
      )}

      {/* Visibility Toggle */}
      <button
        onClick={(e) => { e.stopPropagation(); toggleVisibility(node.id); }}
        className="opacity-50 hover:opacity-100"
      >
        {node.isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
      </button>

      {/* Type Icon */}
      <IconComponent className="w-4 h-4 text-muted-foreground" />

      {/* Name */}
      <span className="flex-1 truncate text-sm">
        {node.name || `${node.type} #${node.id}`}
      </span>

      {/* Element Count */}
      {node.elementCount !== undefined && (
        <span className="text-xs text-muted-foreground">
          {node.elementCount}
        </span>
      )}
    </div>
  );
};
```

### 4.3 Type Icons Mapping

```typescript
const TYPE_ICONS: Record<string, LucideIcon> = {
  // Spatial
  IfcProject: FolderKanban,
  IfcSite: MapPin,
  IfcBuilding: Building2,
  IfcBuildingStorey: Layers,
  IfcSpace: Box,

  // Structure
  IfcWall: Square,
  IfcWallStandardCase: Square,
  IfcSlab: RectangleHorizontal,
  IfcColumn: Cylinder,
  IfcBeam: Minus,
  IfcRoof: Triangle,
  IfcStair: ArrowUpSquare,
  IfcRailing: Fence,

  // Openings
  IfcWindow: PanelTop,
  IfcDoor: DoorOpen,
  IfcCurtainWall: LayoutGrid,

  // MEP
  IfcFlowSegment: Spline,
  IfcFlowTerminal: CircleDot,
  IfcFlowFitting: GitMerge,
  IfcDistributionElement: Cable,

  // Furniture
  IfcFurnishingElement: Armchair,

  // Default
  default: Cube,
};
```

---

## Phase 5: Selection & Highlighting

### 5.1 Visual Selection Modes

```typescript
enum SelectionVisualMode {
  OUTLINE = 'outline',           // Colored outline around selection
  GLOW = 'glow',                 // Bloom/glow effect
  TINT = 'tint',                 // Color tint overlay
  TRANSPARENCY = 'transparency', // Make others semi-transparent
  WIREFRAME = 'wireframe',       // Show wireframe on selection
}

interface SelectionConfig {
  visualMode: SelectionVisualMode;
  color: [number, number, number];    // RGB 0-1
  intensity: number;                   // 0-1
  pulseAnimation: boolean;             // Subtle pulse
  showOthersTransparent: boolean;      // Dim non-selected
  otherTransparency: number;           // 0-1
}

const DEFAULT_SELECTION_CONFIG: SelectionConfig = {
  visualMode: SelectionVisualMode.OUTLINE,
  color: [0.23, 0.51, 0.96],  // Blue
  intensity: 1.0,
  pulseAnimation: true,
  showOthersTransparent: false,
  otherTransparency: 0.3,
};
```

### 5.2 Selection Shader Enhancement

```wgsl
// Edge detection post-process for selection outline
@fragment
fn fs_outline(in: VertexOutput) -> @location(0) vec4f {
  let objectId = textureLoad(objectIdTexture, vec2i(in.position.xy), 0).r;
  let isSelected = objectId == selectedObjectId;

  // Sample neighbors for edge detection
  let neighbors = array<vec2i, 8>(
    vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1),
    vec2i(-1, 0),               vec2i(1, 0),
    vec2i(-1, 1),  vec2i(0, 1), vec2i(1, 1)
  );

  var isEdge = false;
  for (var i = 0u; i < 8u; i++) {
    let neighborId = textureLoad(objectIdTexture, vec2i(in.position.xy) + neighbors[i], 0).r;
    if ((isSelected && neighborId != selectedObjectId) ||
        (!isSelected && neighborId == selectedObjectId)) {
      isEdge = true;
      break;
    }
  }

  if (isEdge) {
    // Animate outline with pulse
    let pulse = sin(time * 3.0) * 0.1 + 0.9;
    return vec4f(selectionColor * pulse, 1.0);
  }

  return textureSample(colorTexture, linearSampler, in.uv);
}
```

### 5.3 Selection Interaction

```typescript
class SelectionManager {
  private selected: Set<number> = new Set();
  private hovered: number | null = null;

  // Selection modes
  select(id: number, mode: 'replace' | 'add' | 'toggle' = 'replace') {
    if (mode === 'replace') {
      this.selected.clear();
      this.selected.add(id);
    } else if (mode === 'add') {
      this.selected.add(id);
    } else {
      if (this.selected.has(id)) {
        this.selected.delete(id);
      } else {
        this.selected.add(id);
      }
    }
    this.notifySelectionChanged();
  }

  selectMultiple(ids: number[], mode: 'replace' | 'add' = 'replace') {
    if (mode === 'replace') {
      this.selected = new Set(ids);
    } else {
      ids.forEach(id => this.selected.add(id));
    }
    this.notifySelectionChanged();
  }

  boxSelect(rect: Rect): Promise<void> {
    // GPU-accelerated box selection
    return this.picker.pickRect(rect).then(ids => {
      this.selectMultiple(ids, 'add');
    });
  }

  // Visibility operations
  isolate(ids?: number[]) {
    const toIsolate = ids ?? Array.from(this.selected);
    this.visibilityManager.isolate(toIsolate);
  }

  hide(ids?: number[]) {
    const toHide = ids ?? Array.from(this.selected);
    this.visibilityManager.hide(toHide);
  }

  showAll() {
    this.visibilityManager.showAll();
  }
}
```

---

## Phase 6: Properties Panel

### 6.1 Enhanced Property Display

```tsx
const PropertyPanel: React.FC = () => {
  const { selectedIds } = useSelection();
  const { query } = useIfc();

  if (selectedIds.length === 0) {
    return <EmptyState icon={MousePointer2} message="Select an object to view properties" />;
  }

  if (selectedIds.length > 1) {
    return <MultiSelectionSummary ids={selectedIds} />;
  }

  const entity = query.entity(selectedIds[0]);

  return (
    <div className="flex flex-col h-full">
      {/* Entity Header */}
      <EntityHeader entity={entity} />

      {/* Quick Info */}
      <QuickInfoSection entity={entity} />

      {/* Tabs */}
      <Tabs defaultValue="properties" className="flex-1">
        <TabsList className="w-full">
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="quantities">Quantities</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="relations">Relations</TabsTrigger>
        </TabsList>

        <TabsContent value="properties">
          <PropertySetsView entity={entity} />
        </TabsContent>

        <TabsContent value="quantities">
          <QuantitiesView entity={entity} />
        </TabsContent>

        <TabsContent value="materials">
          <MaterialsView entity={entity} />
        </TabsContent>

        <TabsContent value="relations">
          <RelationsView entity={entity} />
        </TabsContent>
      </Tabs>
    </div>
  );
};
```

### 6.2 Entity Header Component

```tsx
const EntityHeader: React.FC<{ entity: EntityNode }> = ({ entity }) => {
  const TypeIcon = getIconForType(entity.type);

  return (
    <div className="p-4 border-b bg-muted/30">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <TypeIcon className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">
            {entity.name || `${entity.type} #${entity.id}`}
          </h3>
          <p className="text-sm text-muted-foreground">
            {entity.type}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-1">
          <TooltipButton icon={Focus} label="Zoom to" onClick={() => zoomTo(entity.id)} />
          <TooltipButton icon={EyeOff} label="Hide" onClick={() => hide(entity.id)} />
          <TooltipButton icon={Copy} label="Copy ID" onClick={() => copyToClipboard(entity.globalId)} />
        </div>
      </div>

      {/* GlobalId (copyable) */}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono bg-muted px-1.5 py-0.5 rounded">
          {entity.globalId}
        </span>
        <button onClick={() => copyToClipboard(entity.globalId)}>
          <Copy className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
```

### 6.3 Property Set Collapsible

```tsx
const PropertySetView: React.FC<{ pset: PropertySet }> = ({ pset }) => {
  return (
    <Collapsible defaultOpen className="border rounded-lg mb-2">
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 hover:bg-muted/50">
        <span className="font-medium text-sm">{pset.name}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {pset.properties.length} properties
          </span>
          <ChevronDown className="w-4 h-4" />
        </div>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="border-t">
          {pset.properties.map((prop) => (
            <div
              key={prop.name}
              className="flex justify-between items-center px-3 py-2 border-b last:border-0 hover:bg-muted/30"
            >
              <span className="text-sm text-muted-foreground">{prop.name}</span>
              <PropertyValue value={prop.value} type={prop.type} />
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
```

---

## Phase 7: Viewport Overlays

### 7.1 ViewCube Component

```tsx
const ViewCube: React.FC = () => {
  const { setPresetView, currentView } = useCamera();

  const faces = [
    { id: 'top', label: 'TOP', position: [0, 1, 0] },
    { id: 'bottom', label: 'BOTTOM', position: [0, -1, 0] },
    { id: 'front', label: 'FRONT', position: [0, 0, 1] },
    { id: 'back', label: 'BACK', position: [0, 0, -1] },
    { id: 'left', label: 'LEFT', position: [-1, 0, 0] },
    { id: 'right', label: 'RIGHT', position: [1, 0, 0] },
  ];

  return (
    <div className="absolute top-4 right-4 w-20 h-20">
      <Canvas>
        <ViewCube3D
          faces={faces}
          onFaceClick={setPresetView}
          currentRotation={currentView.rotation}
        />
      </Canvas>
    </div>
  );
};
```

### 7.2 Scale Bar

```tsx
const ScaleBar: React.FC = () => {
  const { pixelsPerMeter } = useCamera();

  // Calculate nice round number for scale
  const targetPixels = 100;
  const meters = targetPixels / pixelsPerMeter;
  const niceMeters = getNiceRoundNumber(meters);
  const actualPixels = niceMeters * pixelsPerMeter;

  return (
    <div className="absolute bottom-4 left-4 flex items-end gap-2">
      <div className="flex flex-col items-center">
        <div
          className="h-1 bg-foreground rounded-full"
          style={{ width: actualPixels }}
        />
        <span className="text-xs mt-1">{formatDistance(niceMeters)}</span>
      </div>
    </div>
  );
};
```

### 7.3 Context Info Bar

```tsx
const ContextBar: React.FC = () => {
  const { selectedStorey, filter, visibleCount, totalCount } = useViewer();

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-background/80 backdrop-blur rounded-full border shadow-sm">
      <div className="flex items-center gap-3 text-sm">
        {selectedStorey && (
          <>
            <Layers className="w-4 h-4 text-muted-foreground" />
            <span>{selectedStorey.name}</span>
            <Separator orientation="vertical" className="h-4" />
          </>
        )}

        {filter && (
          <>
            <Filter className="w-4 h-4 text-muted-foreground" />
            <span>{filter}</span>
            <Separator orientation="vertical" className="h-4" />
          </>
        )}

        <span className="text-muted-foreground">
          {visibleCount.toLocaleString()} / {totalCount.toLocaleString()} visible
        </span>
      </div>
    </div>
  );
};
```

### 7.4 Hover Tooltip

```tsx
const HoverTooltip: React.FC = () => {
  const { hoveredEntity, mousePosition } = useHover();

  if (!hoveredEntity) return null;

  return (
    <div
      className="fixed z-50 px-3 py-2 bg-popover text-popover-foreground rounded-md shadow-lg border pointer-events-none"
      style={{
        left: mousePosition.x + 16,
        top: mousePosition.y + 16,
      }}
    >
      <div className="flex items-center gap-2">
        <TypeIcon type={hoveredEntity.type} className="w-4 h-4" />
        <span className="font-medium">{hoveredEntity.name || hoveredEntity.type}</span>
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">
        #{hoveredEntity.id}
      </div>
    </div>
  );
};
```

---

## Phase 8: Status Bar

### 8.1 Status Bar Layout

```tsx
const StatusBar: React.FC = () => {
  const { loading, progress } = useLoading();
  const { elementCount, triangleCount, fps, memoryUsage } = useStats();
  const { gpuBackend, webgpuSupported } = useRenderer();

  return (
    <div className="h-7 px-4 border-t bg-muted/30 flex items-center justify-between text-xs">
      {/* Left: Status */}
      <div className="flex items-center gap-4">
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>{progress?.phase}: {progress?.percent}%</span>
          </div>
        ) : (
          <span className="text-muted-foreground">Ready</span>
        )}
      </div>

      {/* Center: Model Stats */}
      <div className="flex items-center gap-4 text-muted-foreground">
        <StatItem icon={Boxes} value={elementCount.toLocaleString()} label="elements" />
        <StatItem icon={Triangle} value={formatNumber(triangleCount)} label="tris" />
      </div>

      {/* Right: Performance */}
      <div className="flex items-center gap-4 text-muted-foreground">
        <StatItem
          value={`${fps}`}
          label="FPS"
          className={fps < 30 ? 'text-destructive' : fps < 50 ? 'text-yellow-500' : ''}
        />
        <StatItem value={formatBytes(memoryUsage)} label="" />
        <div className="flex items-center gap-1">
          {webgpuSupported ? (
            <CheckCircle2 className="w-3 h-3 text-green-500" />
          ) : (
            <AlertCircle className="w-3 h-3 text-yellow-500" />
          )}
          <span>{gpuBackend}</span>
        </div>
      </div>
    </div>
  );
};
```

---

## Phase 9: Loading Experience

### 9.1 Skeleton UI

```tsx
const LoadingSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col h-screen">
      {/* Header Skeleton */}
      <div className="h-12 border-b flex items-center px-4 gap-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>

      {/* Toolbar Skeleton */}
      <div className="h-11 border-b flex items-center px-4 gap-2">
        {Array(8).fill(0).map((_, i) => (
          <Skeleton key={i} className="h-8 w-8 rounded" />
        ))}
      </div>

      {/* Main Content */}
      <div className="flex flex-1">
        {/* Left Panel */}
        <div className="w-72 border-r p-4 space-y-4">
          <Skeleton className="h-10 w-full" />
          {Array(10).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" style={{ width: `${100 - i * 5}%` }} />
          ))}
        </div>

        {/* Viewport */}
        <div className="flex-1 flex items-center justify-center bg-muted/30">
          <div className="text-center">
            <Loader2 className="w-12 h-12 animate-spin text-muted-foreground mx-auto" />
            <p className="mt-4 text-muted-foreground">Loading model...</p>
          </div>
        </div>

        {/* Right Panel */}
        <div className="w-80 border-l p-4 space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-8 w-full" />
          {Array(6).fill(0).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
};
```

### 9.2 Progressive Loading Indicator

```tsx
const LoadingOverlay: React.FC = () => {
  const { progress, meshCount, expectedMeshes, timeElapsed } = useLoading();

  return (
    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-96 p-6 bg-card rounded-lg shadow-lg border">
        {/* Progress Ring */}
        <div className="flex justify-center mb-4">
          <ProgressRing progress={progress.percent} size={80} />
        </div>

        {/* Phase Info */}
        <div className="text-center mb-4">
          <h3 className="font-semibold">{progress.phase}</h3>
          <p className="text-sm text-muted-foreground">
            {meshCount.toLocaleString()} / {expectedMeshes.toLocaleString()} meshes
          </p>
        </div>

        {/* Progress Bar */}
        <Progress value={progress.percent} className="h-2 mb-2" />

        {/* Stats */}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{Math.round(progress.percent)}%</span>
          <span>{formatDuration(timeElapsed)}</span>
        </div>

        {/* Tip */}
        <p className="mt-4 text-xs text-center text-muted-foreground">
          Tip: You can start navigating as soon as the first geometry appears
        </p>
      </div>
    </div>
  );
};
```

---

## Phase 10: Mobile Experience

### 10.1 Responsive Layout

```tsx
const ViewerLayout: React.FC = () => {
  const { width } = useWindowSize();
  const isMobile = width < BREAKPOINTS.mobile;
  const isTablet = width < BREAKPOINTS.tablet;

  if (isMobile) {
    return <MobileLayout />;
  }

  if (isTablet) {
    return <TabletLayout />;
  }

  return <DesktopLayout />;
};

const MobileLayout: React.FC = () => {
  const [activeSheet, setActiveSheet] = useState<'hierarchy' | 'properties' | null>(null);

  return (
    <div className="flex flex-col h-screen">
      {/* Compact Header */}
      <MobileHeader />

      {/* Viewport */}
      <div className="flex-1 relative">
        <Viewport />

        {/* Floating Action Buttons */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <FloatingButton icon={Layers} onClick={() => setActiveSheet('hierarchy')} />
          <FloatingButton icon={Info} onClick={() => setActiveSheet('properties')} />
        </div>

        {/* Touch Toolbar */}
        <div className="absolute bottom-4 left-4 flex gap-2">
          <TouchToolButton icon={Home} onTap={fitAll} />
          <TouchToolButton icon={Ruler} onTap={startMeasure} />
          <TouchToolButton icon={Scissors} onTap={showSectionMenu} />
        </div>
      </div>

      {/* Bottom Sheets */}
      <BottomSheet open={activeSheet === 'hierarchy'} onClose={() => setActiveSheet(null)}>
        <HierarchyPanel />
      </BottomSheet>

      <BottomSheet open={activeSheet === 'properties'} onClose={() => setActiveSheet(null)}>
        <PropertyPanel />
      </BottomSheet>
    </div>
  );
};
```

### 10.2 Touch Gesture Enhancements

```typescript
const TOUCH_GESTURES = {
  singleTap: {
    action: 'select',
    delay: 200,  // Distinguish from pan start
  },
  doubleTap: {
    action: 'zoomToSelection',
    delay: 300,
  },
  longPress: {
    action: 'contextMenu',
    duration: 500,
  },
  twoFingerTap: {
    action: 'resetView',
  },
  pinch: {
    action: 'zoom',
    sensitivity: 1.0,
  },
  twoFingerDrag: {
    action: 'pan',
    sensitivity: 1.0,
  },
  rotate: {
    action: 'orbit',
    sensitivity: 1.0,
  },
};
```

---

## Phase 11: Keyboard Shortcuts

### 11.1 Shortcut System

```typescript
const KEYBOARD_SHORTCUTS: ShortcutGroup[] = [
  {
    group: 'Navigation',
    shortcuts: [
      { key: 'V', description: 'Select tool', action: () => setTool('select') },
      { key: 'H', description: 'Pan tool', action: () => setTool('pan') },
      { key: 'O', description: 'Orbit tool', action: () => setTool('orbit') },
      { key: 'C', description: 'Toggle first-person mode', action: toggleFirstPerson },
      { key: 'F', description: 'Fit all', action: fitAll },
      { key: 'Z', description: 'Zoom to selection', action: zoomToSelection },
    ],
  },
  {
    group: 'Views',
    shortcuts: [
      { key: '1', description: 'Top view', action: () => setView('top') },
      { key: '2', description: 'Bottom view', action: () => setView('bottom') },
      { key: '3', description: 'Front view', action: () => setView('front') },
      { key: '4', description: 'Back view', action: () => setView('back') },
      { key: '5', description: 'Left view', action: () => setView('left') },
      { key: '6', description: 'Right view', action: () => setView('right') },
      { key: '0', description: 'Isometric view', action: () => setView('isometric') },
    ],
  },
  {
    group: 'Selection',
    shortcuts: [
      { key: 'Escape', description: 'Clear selection', action: clearSelection },
      { key: 'A', modifiers: ['Ctrl'], description: 'Select all', action: selectAll },
      { key: 'I', description: 'Isolate selection', action: isolateSelection },
      { key: 'Delete', description: 'Hide selection', action: hideSelection },
      { key: 'A', description: 'Show all', action: showAll },
    ],
  },
  {
    group: 'Tools',
    shortcuts: [
      { key: 'M', description: 'Measure tool', action: () => setTool('measure') },
      { key: 'X', description: 'Section tool', action: () => setTool('section') },
    ],
  },
];
```

### 11.2 Shortcut Help Dialog

```tsx
const ShortcutHelpDialog: React.FC = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Keyboard className="w-4 h-4 mr-2" />
          Shortcuts
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6 mt-4">
          {KEYBOARD_SHORTCUTS.map((group) => (
            <div key={group.group}>
              <h4 className="font-medium mb-2">{group.group}</h4>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div key={shortcut.key} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{shortcut.description}</span>
                    <kbd className="px-2 py-0.5 bg-muted rounded text-xs font-mono">
                      {shortcut.modifiers?.join(' + ')}{shortcut.modifiers ? ' + ' : ''}{shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
```

---

## Phase 12: Context Menus

### 12.1 Object Context Menu

```tsx
const ObjectContextMenu: React.FC<{ entity: Entity }> = ({ entity }) => {
  return (
    <ContextMenu>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => zoomTo(entity.id)}>
          <Maximize2 className="w-4 h-4 mr-2" />
          Zoom to
        </ContextMenuItem>

        <ContextMenuItem onClick={() => isolate(entity.id)}>
          <Focus className="w-4 h-4 mr-2" />
          Isolate
        </ContextMenuItem>

        <ContextMenuItem onClick={() => hide(entity.id)}>
          <EyeOff className="w-4 h-4 mr-2" />
          Hide
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => selectSimilar(entity.type)}>
          <Layers className="w-4 h-4 mr-2" />
          Select all {entity.type}
        </ContextMenuItem>

        <ContextMenuItem onClick={() => selectSameStorey(entity.id)}>
          <Building2 className="w-4 h-4 mr-2" />
          Select same storey
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onClick={() => copyProperties(entity.id)}>
          <Copy className="w-4 h-4 mr-2" />
          Copy properties
        </ContextMenuItem>

        <ContextMenuItem onClick={() => exportSelection(entity.id)}>
          <Download className="w-4 h-4 mr-2" />
          Export selection...
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
```

---

## Implementation Priority & Roadmap

### Sprint 1: Foundation (Design System)
- [ ] Install and configure Tailwind CSS
- [ ] Set up shadcn/ui components
- [ ] Create color system with CSS variables
- [ ] Implement base Button, Input, Tooltip components
- [ ] Set up Lucide icons

### Sprint 2: Layout System
- [ ] Implement resizable panel system
- [ ] Create responsive breakpoints
- [ ] Build header and status bar
- [ ] Add panel collapse/expand functionality

### Sprint 3: Toolbar & Tools
- [ ] Design and implement toolbar component
- [ ] Add tool state management
- [ ] Implement isolate/hide/show functionality
- [ ] Add preset view buttons

### Sprint 4: Hierarchy Panel
- [ ] Build virtual scrolling tree
- [ ] Add search/filter functionality
- [ ] Implement visibility toggles
- [ ] Add context menus

### Sprint 5: Properties Panel Enhancement
- [ ] Redesign entity header
- [ ] Implement collapsible property sets
- [ ] Add tabs for quantities/materials/relations
- [ ] Build multi-selection summary

### Sprint 6: Selection System
- [ ] Implement selection shader (outline)
- [ ] Add hover highlighting
- [ ] Build box selection
- [ ] Add selection animations

### Sprint 7: Viewport Overlays
- [ ] Build ViewCube component
- [ ] Add scale bar
- [ ] Create context info bar
- [ ] Implement hover tooltip

### Sprint 8: Loading Experience
- [ ] Create skeleton UI
- [ ] Build progress overlay
- [ ] Add loading tips/hints
- [ ] Implement progressive reveal

### Sprint 9: Mobile Experience
- [ ] Build responsive layouts
- [ ] Implement bottom sheets
- [ ] Add touch gesture enhancements
- [ ] Create floating action buttons

### Sprint 10: Polish & Accessibility
- [ ] Add keyboard navigation
- [ ] Implement ARIA labels
- [ ] Create shortcut help dialog
- [ ] Add dark mode
- [ ] Performance optimization

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| First Contentful Paint | ~3s | <1s |
| Time to Interactive | ~5s | <2s |
| Lighthouse Performance | ~60 | >90 |
| Lighthouse Accessibility | ~40 | >95 |
| Bundle Size (gzipped) | ~800KB | <500KB |
| FPS during navigation | 60 | 60 |
| User satisfaction score | N/A | >4.5/5 |

---

*This plan transforms the IFC-Lite viewer from a functional prototype into a world-class BIM viewing experience.*
