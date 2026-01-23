# IFC5 Federated Loading Implementation Plan

## Executive Summary

This document outlines a comprehensive plan to implement full IFC5 federated loading support in ifc-lite. IFC5 introduces a paradigm shift from monolithic files to a component-based, multi-file architecture inspired by USD (Universal Scene Description). The goal is seamless loading and composition of multiple IFCX files with automatic reference resolution, layer ordering, and unified viewer integration.

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [IFC5 Federation Concepts](#2-ifc5-federation-concepts)
3. [Gap Analysis](#3-gap-analysis)
4. [Architecture Design](#4-architecture-design)
5. [Implementation Phases](#5-implementation-phases)
6. [Data Structures](#6-data-structures)
7. [API Design](#7-api-design)
8. [Testing Strategy](#8-testing-strategy)
9. [Migration Path](#9-migration-path)

---

## 1. Current State Analysis

### 1.1 Existing Multi-Model Support (IFC4/STEP)

The codebase already implements robust multi-model loading for IFC4:

| Component | Location | Purpose |
|-----------|----------|---------|
| `FederationRegistry` | `packages/renderer/src/federation-registry.ts` | ID offset management for collision prevention |
| `ModelSlice` | `apps/viewer/src/store/slices/modelSlice.ts` | Multi-model CRUD operations |
| `useIfc.addModel()` | `apps/viewer/src/hooks/useIfc.ts` | Sequential file loading |
| `HierarchyPanel` | `apps/viewer/src/components/viewer/HierarchyPanel.tsx` | Unified storey grouping |

**Key Features:**
- Automatic ID collision prevention via offsets
- Per-model visibility toggling
- Unified hierarchy view with storey elevation matching
- Selection state tracks (modelId, expressId) pairs

### 1.2 Existing IFC5 Support

The `@ifc-lite/ifcx` package provides single-file IFCX parsing:

| Module | Purpose |
|--------|---------|
| `composition.ts` | ECS node composition with layer semantics |
| `entity-extractor.ts` | Entity extraction with synthetic expressIds |
| `property-extractor.ts` | Property extraction from namespaced attributes |
| `geometry-extractor.ts` | USD mesh extraction with coordinate conversion |
| `hierarchy-builder.ts` | Spatial hierarchy from children relationships |

**Current Capabilities:**
- JSON parsing with header validation
- Node flattening with later-wins semantics
- Inheritance resolution (`inherits` references)
- Children tree construction
- Geometry transformation and Y-up conversion

---

## 2. IFC5 Federation Concepts

### 2.1 Core Paradigm: USD-Inspired Layering

IFC5 adopts the Entity-Component-System (ECS) pattern with USD-style composition:

```
┌─────────────────────────────────────────────────────────┐
│                     Composed Stage                       │
│  (Final merged view visible to the application)         │
└─────────────────────────────────────────────────────────┘
                           ▲
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────┴──────┐ ┌──────┴──────┐ ┌──────┴──────┐
    │   Layer 1   │ │   Layer 2   │ │   Layer 3   │
    │ (Geometry)  │ │(Properties) │ │  (MEP Add)  │
    │   Base      │ │  Override   │ │   Override  │
    └─────────────┘ └─────────────┘ └─────────────┘
         ▲
    Strongest               →              Weakest
```

### 2.2 Reference Mechanisms

IFC5 supports multiple reference types:

#### Direct UUID Reference
```json
{
  "path": "93791d5d-5beb-437b-b8ec-2f1f0ba4bf3b",
  "attributes": { "bsi::ifc::prop::FireRating": "R30" }
}
```

#### Hierarchical Path Reference
```json
{
  "path": "ab143723-f7b1-5368-b106-55896e88d768/My_Project/My_Site/My_Building/Wall",
  "attributes": { "bsi::ifc::prop::FireRating": "R60" }
}
```

#### Inheritance Reference
```json
{
  "path": "new-window-uuid",
  "inherits": { "windowType": "25503984-6605-43a1-8597-eae657ff5bea" }
}
```

#### Children Extension
```json
{
  "path": "existing-storey-uuid",
  "children": { "NewWall": "new-wall-uuid" }
}
```

### 2.3 Layer Composition Rules

Following USD LIVRPS (Local, Inherit, Variant, Reference, Payload, Specialize):

1. **Higher layers override lower layers** (layer order determines strength)
2. **Null values remove** (`children: { "Name": null }` removes child)
3. **Attributes merge** (later wins for same key)
4. **Children merge** (accumulated across layers)
5. **Inheritance is resolved** before merging

### 2.4 Federation Use Cases from Sample Files

| Sample | Pattern | Description |
|--------|---------|-------------|
| `hello-wall-add-fire-rating-30.ifcx` | Property overlay | Adds FireRating property to existing wall |
| `hello-wall-add-specific-fire-rating.ifcx` | Mixed references | Uses both UUID and path references |
| `add-2nd-storey.ifcx` | Structure extension | Adds new storey via inheritance |
| `3rd-window.ifcx` | Geometry modification | Adds window and updates wall mesh |
| `PCERT-Sample-Scene_*.ifcx` | Discipline separation | Architecture/Structural/MEP in separate files |

---

## 3. Gap Analysis

### 3.1 Missing Capabilities

| Gap | Current State | Required State |
|-----|---------------|----------------|
| Multi-file composition | Single file only | Compose N files with layer ordering |
| Cross-file path resolution | Not supported | Resolve paths across file boundaries |
| Hierarchical path parsing | UUID only | Support `uuid/Child/Grandchild` paths |
| Import resolution | Ignored | Fetch and merge imported schemas/data |
| Layer ordering UI | None | User-controlled layer ordering |
| Federated caching | None | Cache composed result with invalidation |
| Reference graphs | None | Track cross-file dependencies |

### 3.2 Integration Gaps

| Component | Current | Required |
|-----------|---------|----------|
| `parseIfcx()` | Single buffer | Multiple buffers with composition |
| `FederationRegistry` | ID offsets for models | Path-based addressing for IFCX |
| `HierarchyPanel` | Model-based grouping | Layer-aware display |
| Property Panel | Model-scoped lookup | Cross-file property merging |

---

## 4. Architecture Design

### 4.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          Viewer UI                               │
├─────────────────────────────────────────────────────────────────┤
│  HierarchyPanel  │  PropertiesPanel  │  LayerPanel (NEW)        │
└────────┬─────────┴────────┬──────────┴──────────┬───────────────┘
         │                  │                      │
         ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Zustand Store                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ ModelSlice  │  │ SelectionS.  │  │ IfcxCompositionSlice   │  │
│  │(IFC4 models)│  │              │  │ (NEW - federated IFCX) │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   @ifc-lite/ifcx Package                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              FederatedComposer (NEW)                       │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐   │  │
│  │  │LayerStack  │  │PathResolver│  │ImportResolver (NEW)│   │  │
│  │  │   (NEW)    │  │   (NEW)    │  └────────────────────┘   │  │
│  │  └────────────┘  └────────────┘                           │  │
│  │         │               │                                  │  │
│  │         ▼               ▼                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │           composeIfcx() (ENHANCED)                   │  │  │
│  │  │    - Multi-file merging                              │  │  │
│  │  │    - Cross-file reference resolution                 │  │  │
│  │  │    - Layer-ordered attribute merging                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │         │                                                  │  │
│  │         ▼                                                  │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  extractEntities() │ extractGeometry() │ etc.        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Layer Stack Model

```typescript
interface IfcxLayerStack {
  // Ordered list of layers (index 0 = strongest)
  layers: IfcxLayer[];

  // Composed result cache
  composedNodes: Map<string, ComposedNode>;
  composedTimestamp: number;

  // Cross-file index
  pathIndex: PathIndex;

  // Dependency graph
  dependencies: DependencyGraph;
}

interface IfcxLayer {
  id: string;
  name: string;
  file: IfcxFile;
  buffer: ArrayBuffer;

  // Layer metadata
  strength: number;           // Position in stack (lower = stronger)
  enabled: boolean;           // Visibility toggle
  source: LayerSource;        // file | url | import

  // Nodes contributed by this layer
  nodesByPath: Map<string, IfcxNode[]>;
}

type LayerSource =
  | { type: 'file'; filename: string }
  | { type: 'url'; url: string }
  | { type: 'import'; uri: string };
```

### 4.3 Path Resolution System

```typescript
interface PathIndex {
  // Direct UUID lookup
  byUuid: Map<string, PathEntry>;

  // Hierarchical path lookup
  byHierarchicalPath: Map<string, PathEntry>;

  // Child name lookup (for path traversal)
  childNameIndex: Map<string, Map<string, string>>; // parentPath -> childName -> childPath
}

interface PathEntry {
  path: string;
  definedInLayers: string[];  // Layer IDs where this path appears
  resolvedNode?: ComposedNode;
}
```

---

## 5. Implementation Phases

### Phase 1: Multi-File Composition Foundation (Week 1-2)

**Goal:** Enable loading multiple IFCX files and composing them with layer ordering.

#### 5.1.1 Layer Stack Data Structures

```typescript
// packages/ifcx/src/layer-stack.ts

export interface IfcxLayer {
  id: string;
  name: string;
  file: IfcxFile;
  strength: number;
  enabled: boolean;
}

export class LayerStack {
  private layers: IfcxLayer[] = [];

  addLayer(file: IfcxFile, name: string): string;
  removeLayer(layerId: string): void;
  reorderLayers(orderedIds: string[]): void;
  setLayerEnabled(layerId: string, enabled: boolean): void;

  getLayers(): readonly IfcxLayer[];
  getEnabledLayers(): IfcxLayer[];
}
```

#### 5.1.2 Enhanced Composition Function

```typescript
// packages/ifcx/src/federated-composition.ts

export interface ComposeOptions {
  /** Layer order (first = strongest) */
  layerOrder?: string[];
  /** Resolve imports automatically */
  resolveImports?: boolean;
  /** Progress callback */
  onProgress?: (phase: string, percent: number) => void;
}

/**
 * Compose multiple IFCX files into a unified stage.
 */
export function composeFederated(
  layers: IfcxLayer[],
  options?: ComposeOptions
): Map<string, ComposedNode>;
```

#### 5.1.3 Implementation Tasks

- [ ] Create `LayerStack` class with add/remove/reorder operations
- [ ] Enhance `composeIfcx()` to accept multiple files
- [ ] Implement layer-ordered attribute merging (strongest wins)
- [ ] Implement children merging across layers
- [ ] Handle `null` values for property/child removal
- [ ] Add unit tests for multi-file composition

### Phase 2: Cross-File Reference Resolution (Week 3-4)

**Goal:** Resolve references (UUIDs, paths, inheritance) across file boundaries.

#### 5.2.1 Path Index Builder

```typescript
// packages/ifcx/src/path-index.ts

export class PathIndex {
  private byUuid = new Map<string, PathEntry>();
  private byHierarchy = new Map<string, PathEntry>();
  private childIndex = new Map<string, Map<string, string>>();

  /**
   * Index all paths from all layers.
   */
  buildIndex(layers: IfcxLayer[]): void;

  /**
   * Resolve a path (UUID or hierarchical).
   */
  resolvePath(path: string): string | null;

  /**
   * Resolve a hierarchical path like "uuid/Child/Grandchild".
   */
  resolveHierarchicalPath(path: string): string | null;
}
```

#### 5.2.2 Hierarchical Path Parser

```typescript
// packages/ifcx/src/path-resolver.ts

export interface ParsedPath {
  root: string;          // Root UUID
  segments: string[];    // Path segments
}

/**
 * Parse IFCX path into components.
 * Examples:
 *   "uuid" -> { root: "uuid", segments: [] }
 *   "uuid/Child/Grandchild" -> { root: "uuid", segments: ["Child", "Grandchild"] }
 */
export function parsePath(path: string): ParsedPath;

/**
 * Resolve path segments by walking children relationships.
 */
export function walkPath(
  root: ComposedNode,
  segments: string[],
  composed: Map<string, ComposedNode>
): ComposedNode | null;
```

#### 5.2.3 Enhanced Inheritance Resolution

```typescript
// In composeFederated()

function resolveInherits(
  node: PreComposedNode,
  allNodes: Map<string, PreComposedNode>,
  pathIndex: PathIndex,
  visited: Set<string>
): void {
  // Resolve inherits references across layers
  for (const [key, inheritPath] of Object.entries(node.inherits)) {
    if (!inheritPath) continue;

    // Try to resolve path (may be in different layer)
    const resolvedPath = pathIndex.resolvePath(inheritPath);
    if (resolvedPath) {
      const inherited = allNodes.get(resolvedPath);
      if (inherited) {
        // Merge inherited attributes/children
        mergeInheritance(node, inherited, visited);
      }
    }
  }
}
```

#### 5.2.4 Implementation Tasks

- [ ] Create `PathIndex` class with UUID and hierarchical indexing
- [ ] Implement hierarchical path parsing (`parsePath()`)
- [ ] Implement path walking through children relationships
- [ ] Enhance inheritance resolution for cross-file references
- [ ] Handle circular reference detection
- [ ] Add tests for cross-file references using sample files

### Phase 3: Import Resolution (Week 5-6)

**Goal:** Automatically fetch and resolve `imports` array entries.

#### 5.3.1 Import Types

```typescript
// packages/ifcx/src/import-resolver.ts

export type ImportSource =
  | { type: 'local'; path: string }
  | { type: 'remote'; url: string }
  | { type: 'ifcx-dev'; uri: string };  // https://ifcx.dev/@org/pkg@version.ifcx

export interface ResolvedImport {
  uri: string;
  source: ImportSource;
  file: IfcxFile | null;
  schemas: Record<string, IfcxSchema>;
  error?: string;
}
```

#### 5.3.2 Import Resolver

```typescript
export class ImportResolver {
  private cache = new Map<string, ResolvedImport>();
  private fetcher: (url: string) => Promise<ArrayBuffer>;

  constructor(options: {
    /** Custom fetch function for environments */
    fetcher?: (url: string) => Promise<ArrayBuffer>;
    /** Base URL for relative imports */
    baseUrl?: string;
    /** Cache resolved imports */
    enableCache?: boolean;
  });

  /**
   * Resolve all imports for a file.
   */
  async resolveImports(file: IfcxFile): Promise<ResolvedImport[]>;

  /**
   * Get merged schemas from all imports.
   */
  getMergedSchemas(imports: ResolvedImport[]): Record<string, IfcxSchema>;
}
```

#### 5.3.3 Schema Registry

```typescript
// packages/ifcx/src/schema-registry.ts

/**
 * Registry for IFCX schemas (from imports and local definitions).
 * Used for validation and type-aware property handling.
 */
export class SchemaRegistry {
  private schemas = new Map<string, IfcxSchema>();

  register(name: string, schema: IfcxSchema): void;
  registerAll(schemas: Record<string, IfcxSchema>): void;

  get(name: string): IfcxSchema | undefined;
  validate(attributeName: string, value: unknown): boolean;
  getDataType(attributeName: string): DataType | undefined;
}
```

#### 5.3.4 Implementation Tasks

- [ ] Create `ImportResolver` class with URL parsing
- [ ] Implement ifcx.dev URI resolution (package registry format)
- [ ] Add schema extraction from imported files
- [ ] Create `SchemaRegistry` for merged schema access
- [ ] Handle import caching and invalidation
- [ ] Add fallback for offline/unavailable imports
- [ ] Create mock fetcher for testing

### Phase 4: Viewer Integration (Week 7-8)

**Goal:** Integrate federated IFCX loading into the viewer UI.

#### 5.4.1 New Store Slice: IfcxCompositionSlice

```typescript
// apps/viewer/src/store/slices/ifcxCompositionSlice.ts

export interface IfcxCompositionSlice {
  // Layer management
  layerStack: LayerStack | null;
  compositionResult: IfcxParseResult | null;

  // Actions
  initializeFederatedIfcx: () => void;
  addIfcxLayer: (buffer: ArrayBuffer, name: string) => Promise<string>;
  removeIfcxLayer: (layerId: string) => void;
  reorderLayers: (orderedIds: string[]) => void;
  toggleLayerVisibility: (layerId: string) => void;
  recomposeIfcx: () => Promise<void>;

  // Selectors
  getLayers: () => IfcxLayer[];
  getComposedResult: () => IfcxParseResult | null;
  isIfcxMode: () => boolean;
}
```

#### 5.4.2 Layer Panel Component

```typescript
// apps/viewer/src/components/viewer/LayerPanel.tsx

interface LayerPanelProps {
  layers: IfcxLayer[];
  onReorder: (orderedIds: string[]) => void;
  onToggleVisibility: (layerId: string) => void;
  onRemove: (layerId: string) => void;
  onAddLayer: () => void;
}

/**
 * Drag-and-drop layer ordering panel for federated IFCX.
 */
export function LayerPanel(props: LayerPanelProps): JSX.Element;
```

#### 5.4.3 Enhanced useIfc Hook

```typescript
// apps/viewer/src/hooks/useIfc.ts

// Add to existing hook
interface UseIfcReturn {
  // ... existing methods

  // Federated IFCX methods
  loadIfcxFederated: (files: File[]) => Promise<void>;
  addIfcxOverlay: (file: File) => Promise<void>;
  getLayerStack: () => LayerStack | null;
}
```

#### 5.4.4 Implementation Tasks

- [ ] Create `IfcxCompositionSlice` in store
- [ ] Build `LayerPanel` component with drag-and-drop
- [ ] Enhance `useIfc` with federated loading methods
- [ ] Update `HierarchyPanel` for layer-aware display
- [ ] Add layer indicator badges to hierarchy items
- [ ] Update properties panel to show layer source
- [ ] Add keyboard shortcuts for layer manipulation

### Phase 5: Property & Geometry Overlay (Week 9-10)

**Goal:** Support overlay files that only add properties or modify geometry.

#### 5.5.1 Sparse Overlay Detection

```typescript
// packages/ifcx/src/overlay-detector.ts

export interface OverlayAnalysis {
  type: 'full' | 'property-only' | 'geometry-only' | 'mixed';
  affectedPaths: string[];
  newPaths: string[];
  modifiedPaths: string[];
}

/**
 * Analyze an overlay file to determine what it modifies.
 */
export function analyzeOverlay(
  overlay: IfcxFile,
  base: Map<string, ComposedNode>
): OverlayAnalysis;
```

#### 5.5.2 Incremental Recomposition

```typescript
// packages/ifcx/src/incremental-compose.ts

/**
 * Recompose only affected nodes when a layer changes.
 * Much faster than full recomposition for overlay scenarios.
 */
export function recomposeIncremental(
  currentComposed: Map<string, ComposedNode>,
  changedLayer: IfcxLayer,
  changeType: 'add' | 'remove' | 'update'
): Map<string, ComposedNode>;
```

#### 5.5.3 Property Merging UI

```typescript
// apps/viewer/src/components/viewer/PropertiesPanel.tsx

interface PropertySource {
  value: unknown;
  layerId: string;
  layerName: string;
  strength: number;
}

interface MergedProperty {
  name: string;
  effectiveValue: unknown;      // From strongest layer
  sources: PropertySource[];    // All definitions across layers
  isOverridden: boolean;        // True if multiple layers define it
}

/**
 * Enhanced property display showing layer sources.
 */
function PropertyRow({ property }: { property: MergedProperty }): JSX.Element;
```

#### 5.5.4 Implementation Tasks

- [ ] Create overlay analysis utility
- [ ] Implement incremental recomposition for performance
- [ ] Enhance property extraction to track layer sources
- [ ] Update properties panel to show override chain
- [ ] Add visual indicators for overridden properties
- [ ] Support geometry updates from overlay layers

### Phase 6: Advanced Features (Week 11-12)

**Goal:** Polish and advanced features for production use.

#### 5.6.1 Federated File Export

```typescript
// packages/ifcx/src/federated-export.ts

export interface ExportOptions {
  /** Export as single merged file or preserve layers */
  mode: 'merged' | 'layered';
  /** Include disabled layers */
  includeDisabled?: boolean;
  /** Strip metadata for smaller output */
  minify?: boolean;
}

/**
 * Export composed IFCX back to file(s).
 */
export function exportFederated(
  layerStack: LayerStack,
  options: ExportOptions
): ArrayBuffer | Map<string, ArrayBuffer>;
```

#### 5.6.2 Conflict Detection & Visualization

```typescript
// packages/ifcx/src/conflict-detector.ts

export interface Conflict {
  path: string;
  attributeKey: string;
  values: Array<{
    layerId: string;
    layerName: string;
    value: unknown;
  }>;
  resolution: 'strongest-wins' | 'last-wins';
  effectiveValue: unknown;
}

/**
 * Detect all conflicts across layers.
 */
export function detectConflicts(
  layerStack: LayerStack
): Conflict[];
```

#### 5.6.3 Layer Templates

```typescript
// packages/ifcx/src/layer-templates.ts

export const LAYER_TEMPLATES = {
  /** Empty property overlay */
  propertyOverlay: (baseId: string) => ({
    header: { /* ... */ },
    imports: [],
    schemas: {},
    data: [{ path: baseId, attributes: {} }]
  }),

  /** New storey via inheritance */
  storeyExtension: (buildingId: string, baseStoreyId: string) => ({
    /* ... */
  }),
};
```

#### 5.6.4 Implementation Tasks

- [ ] Implement federated export functionality
- [ ] Create conflict detection and visualization
- [ ] Build layer template system for common patterns
- [ ] Add undo/redo support for layer operations
- [ ] Implement layer diff viewer
- [ ] Add layer creation wizard UI

---

## 6. Data Structures

### 6.1 Complete Type Definitions

```typescript
// packages/ifcx/src/types.ts - Enhanced

// ============================================================================
// Federated Composition Types
// ============================================================================

export interface IfcxLayer {
  id: string;
  name: string;
  file: IfcxFile;

  // Position in stack (lower = stronger)
  strength: number;

  // Visibility
  enabled: boolean;

  // Source tracking
  source: LayerSource;

  // Parsed nodes for this layer only
  nodesByPath: Map<string, IfcxNode[]>;

  // Timestamps for cache invalidation
  loadedAt: number;
  modifiedAt: number;
}

export type LayerSource =
  | { type: 'file'; filename: string; size: number }
  | { type: 'url'; url: string }
  | { type: 'import'; uri: string; parentLayer: string };

export interface LayerStack {
  layers: IfcxLayer[];

  // Composed result cache
  composed: Map<string, ComposedNode> | null;
  composedAt: number | null;

  // Index for cross-file lookups
  pathIndex: PathIndex | null;
}

export interface PathIndex {
  // UUID -> path entry
  byUuid: Map<string, PathEntry>;

  // Hierarchical path string -> path entry
  byHierarchy: Map<string, PathEntry>;

  // Parent UUID -> (child name -> child UUID)
  childNameIndex: Map<string, Map<string, string>>;
}

export interface PathEntry {
  uuid: string;                    // Canonical UUID
  hierarchicalPaths: string[];     // All known hierarchical paths to this node
  definedInLayers: string[];       // Layer IDs where this path appears
  primaryLayer: string;            // Strongest layer defining this path
}

// ============================================================================
// Enhanced Composed Node
// ============================================================================

export interface ComposedNode {
  path: string;
  attributes: Map<string, unknown>;
  children: Map<string, ComposedNode>;
  parent?: ComposedNode;

  // NEW: Source tracking
  attributeSources: Map<string, AttributeSource>;
  definedInLayers: Set<string>;
}

export interface AttributeSource {
  layerId: string;
  layerName: string;
  strength: number;
  originalValue: unknown;
}

// ============================================================================
// Federated Parse Result
// ============================================================================

export interface FederatedIfcxParseResult extends IfcxParseResult {
  // Layer information
  layerStack: LayerStack;

  // Cross-file mappings
  pathToLayerMap: Map<string, string[]>;  // path -> layer IDs

  // Conflict information
  conflicts: Conflict[];
}

export interface Conflict {
  path: string;
  attributeKey: string;
  layerValues: Map<string, unknown>;  // layerId -> value
  resolvedValue: unknown;
}
```

### 6.2 Store State Shape

```typescript
// apps/viewer/src/store/types.ts - Enhanced

export interface IfcxCompositionState {
  // Is federated IFCX mode active?
  isFederatedMode: boolean;

  // Layer stack (null if not in federated mode)
  layerStack: LayerStack | null;

  // Composed and parsed result
  compositionResult: FederatedIfcxParseResult | null;

  // Loading state
  isComposing: boolean;
  composeProgress: { phase: string; percent: number } | null;
  composeError: string | null;

  // UI state
  expandedLayerIds: Set<string>;
  selectedLayerId: string | null;
  highlightedConflicts: Set<string>;  // paths with conflicts
}
```

---

## 7. API Design

### 7.1 Public API

```typescript
// packages/ifcx/src/index.ts - Enhanced exports

// Federated composition
export { LayerStack, createLayerStack } from './layer-stack.js';
export { composeFederated, type ComposeOptions } from './federated-composition.js';
export { PathIndex, parsePath, resolvePath } from './path-resolver.js';
export { ImportResolver, type ImportSource } from './import-resolver.js';

// Analysis
export { analyzeOverlay, type OverlayAnalysis } from './overlay-detector.js';
export { detectConflicts, type Conflict } from './conflict-detector.js';

// Export
export { exportFederated, type ExportOptions } from './federated-export.js';

// Main entry point for federated parsing
export async function parseFederatedIfcx(
  files: Array<{ buffer: ArrayBuffer; name: string }>,
  options?: FederatedParseOptions
): Promise<FederatedIfcxParseResult>;
```

### 7.2 Viewer API

```typescript
// apps/viewer/src/hooks/useIfcx.ts (NEW)

export function useIfcx() {
  return {
    // Load multiple IFCX files as federated layers
    loadFederated: (files: File[]) => Promise<void>,

    // Add overlay to existing composition
    addOverlay: (file: File) => Promise<void>,

    // Layer management
    layers: IfcxLayer[],
    reorderLayers: (orderedIds: string[]) => void,
    toggleLayer: (layerId: string) => void,
    removeLayer: (layerId: string) => void,

    // State
    isComposing: boolean,
    composeProgress: { phase: string; percent: number } | null,

    // Utilities
    getPropertySource: (expressId: number, propName: string) => AttributeSource | null,
    getConflicts: () => Conflict[],
  };
}
```

---

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// packages/ifcx/tests/federated-composition.test.ts

describe('composeFederated', () => {
  it('should merge attributes with layer ordering', () => {
    const base = createTestLayer('base', [
      { path: 'uuid-1', attributes: { 'bsi::ifc::prop::Name': 'Wall-1' } }
    ]);
    const overlay = createTestLayer('overlay', [
      { path: 'uuid-1', attributes: { 'bsi::ifc::prop::FireRating': 'R30' } }
    ]);

    const composed = composeFederated([overlay, base]);
    const node = composed.get('uuid-1');

    expect(node.attributes.get('bsi::ifc::prop::Name')).toBe('Wall-1');
    expect(node.attributes.get('bsi::ifc::prop::FireRating')).toBe('R30');
  });

  it('should resolve cross-file inheritance', () => { /* ... */ });
  it('should handle hierarchical paths', () => { /* ... */ });
  it('should detect circular references', () => { /* ... */ });
});
```

### 8.2 Integration Tests

```typescript
// apps/viewer/tests/federated-loading.test.ts

describe('Federated IFCX Loading', () => {
  it('should load Hello Wall with fire rating overlay', async () => {
    const helloWall = await loadTestFile('Hello_Wall_hello-wall.ifcx');
    const fireRating = await loadTestFile('Hello_Wall_hello-wall-add-fire-rating-30.ifcx');

    const result = await parseFederatedIfcx([
      { buffer: helloWall, name: 'hello-wall.ifcx' },
      { buffer: fireRating, name: 'add-fire-rating.ifcx' },
    ]);

    // Wall should have fire rating from overlay
    const wallProps = result.properties.getForEntity(/* wall expressId */);
    expect(wallProps.find(p => p.name === 'FireRating')?.value).toBe('R30');
  });

  it('should load PCERT sample scene disciplines', async () => {
    const architecture = await loadTestFile('PCERT-Sample-Scene_Building-Architecture.ifcx');
    const structural = await loadTestFile('PCERT-Sample-Scene_Building-Structural.ifcx');
    const hvac = await loadTestFile('PCERT-Sample-Scene_Building-Hvac.ifcx');

    const result = await parseFederatedIfcx([
      { buffer: architecture, name: 'Architecture' },
      { buffer: structural, name: 'Structural' },
      { buffer: hvac, name: 'HVAC' },
    ]);

    // Should have geometry from all disciplines
    expect(result.meshes.length).toBeGreaterThan(0);
    // Should have unified hierarchy
    expect(result.spatialHierarchy.project).toBeDefined();
  });
});
```

### 8.3 Visual Regression Tests

```typescript
// apps/viewer/tests/visual/federated.test.ts

describe('Federated IFCX Visual', () => {
  it('should render hello wall correctly', async () => {
    await loadFederatedFiles(['hello-wall.ifcx']);
    await waitForRender();
    await expect(page).toHaveScreenshot('hello-wall-base.png');
  });

  it('should render with fire rating overlay', async () => {
    await loadFederatedFiles(['hello-wall.ifcx', 'add-fire-rating.ifcx']);
    await waitForRender();
    // Properties panel should show fire rating
    await selectEntity('Wall');
    await expect(page.locator('.property-panel')).toContainText('FireRating');
    await expect(page.locator('.property-panel')).toContainText('R30');
  });
});
```

---

## 9. Migration Path

### 9.1 Backward Compatibility

The existing `parseIfcx()` function remains unchanged for single-file loading:

```typescript
// Single file (existing API)
const result = await parseIfcx(buffer);

// Federated files (new API)
const result = await parseFederatedIfcx([
  { buffer: buffer1, name: 'base.ifcx' },
  { buffer: buffer2, name: 'overlay.ifcx' },
]);
```

### 9.2 Auto-Detection

```typescript
// apps/viewer/src/hooks/useIfc.ts

async function loadFiles(files: File[]) {
  const formats = await Promise.all(files.map(f => detectFormat(f)));

  if (formats.every(f => f === 'ifcx')) {
    // All IFCX - use federated loading
    await loadFederatedIfcx(files);
  } else if (formats.every(f => f === 'ifc')) {
    // All IFC - use existing multi-model
    await loadFilesSequentially(files);
  } else {
    // Mixed - load separately
    await loadMixed(files, formats);
  }
}
```

### 9.3 Feature Flags

```typescript
// apps/viewer/src/config.ts

export const FEATURE_FLAGS = {
  FEDERATED_IFCX: true,          // Enable federated IFCX loading
  IFCX_IMPORT_RESOLUTION: false, // Auto-resolve imports (requires network)
  IFCX_LAYER_PANEL: true,        // Show layer panel for IFCX
  IFCX_CONFLICT_VIEW: false,     // Show conflict visualization
};
```

---

## 10. Timeline Summary

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| Phase 1: Multi-File Composition | 2 weeks | LayerStack, enhanced composeIfcx |
| Phase 2: Cross-File References | 2 weeks | PathIndex, hierarchical path resolution |
| Phase 3: Import Resolution | 2 weeks | ImportResolver, SchemaRegistry |
| Phase 4: Viewer Integration | 2 weeks | IfcxCompositionSlice, LayerPanel |
| Phase 5: Property/Geometry Overlay | 2 weeks | Incremental recomposition, source tracking |
| Phase 6: Advanced Features | 2 weeks | Export, conflicts, templates |

**Total: 12 weeks (3 months)**

---

## 11. Sample Files for Testing

The codebase includes comprehensive IFC5 sample files:

### Basic Federation
- `Hello_Wall_hello-wall.ifcx` - Base model
- `Hello_Wall_hello-wall-add-fire-rating-30.ifcx` - Property overlay
- `Hello_Wall_hello-wall-add-fire-rating-60.ifcx` - Alternative overlay
- `Hello_Wall_hello-wall-add-specific-fire-rating.ifcx` - Path references

### Advanced Federation
- `Hello_Wall_advanced_3rd-window.ifcx` - Geometry modification
- `Hello_Wall_advanced_add-2nd-storey.ifcx` - Structure extension
- `Hello_Wall_advanced_double-wall.ifcx` - Element duplication

### Multi-Discipline
- `PCERT-Sample-Scene_Building-Architecture.ifcx`
- `PCERT-Sample-Scene_Building-Structural.ifcx`
- `PCERT-Sample-Scene_Building-Hvac.ifcx`
- `PCERT-Sample-Scene_Building-Landscaping.ifcx`
- `PCERT-Sample-Scene_Infra-*.ifcx` (Bridge, Electrical, Rail, Road)

### Infrastructure
- `Geotech_WekaHills_*.ifcx` - Geotechnical files
- `Railway_Railway_project_*.ifcx` - Railway files
- `Tunnel_Excavation_*.ifcx` - Sequential tunnel construction

---

## 12. Success Criteria

The implementation is complete when:

1. **Functional**
   - [ ] Load 10+ IFCX files as federated layers
   - [ ] Cross-file references resolve correctly
   - [ ] Layer reordering produces expected results
   - [ ] Properties show layer sources
   - [ ] Geometry from all layers renders

2. **Performance**
   - [ ] Initial composition < 2s for Hello Wall + overlay
   - [ ] Incremental recomposition < 500ms
   - [ ] Memory usage < 2x single largest file

3. **UX**
   - [ ] Drag-and-drop layer ordering
   - [ ] Clear conflict visualization
   - [ ] Layer visibility toggles work instantly
   - [ ] Property panel shows override chain

4. **Compatibility**
   - [ ] All sample files load correctly
   - [ ] PCERT multi-discipline scene works
   - [ ] Tunnel sequence loads correctly

---

## Appendix: Reference Links

- [IFC5-development Repository](https://github.com/buildingSMART/IFC5-development)
- [IFCX Schema (ifcx.dev)](https://ifcx.dev/)
- [IFC5 Technical Site](https://ifc5.technical.buildingsmart.org/)
- [OpenUSD Composition](https://openusd.org/release/glossary.html#usdglossary-compositionarcs)
- [IFC5 Examples FAQ](https://github.com/buildingSMART/IFC5-development/blob/main/Examples_FAQ.md)
