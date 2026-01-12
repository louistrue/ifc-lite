# IFC-Lite Viewer: Showcase Application

## A High-Performance WebGPU Viewer for Massive IFC Models

**Version:** 1.0.0  
**Author:** Louis / Ltplus AG  
**Date:** January 2026  
**Status:** Technical Specification

---

## Document Structure

| Part | Title | Description |
|------|-------|-------------|
| 01 | Overview & Architecture | Vision, targets, system design |
| 02 | Rendering Pipeline | WebGPU, LOD, culling, instancing |
| 03 | Data Management | Streaming, memory, out-of-core |
| 04 | User Interface | Navigation, selection, tools |
| 05 | Implementation Plan | Timeline, milestones, resources |

---

## Executive Summary

The IFC-Lite Viewer is a **showcase application** demonstrating the full potential of IFC-Lite. It handles models with **10+ million triangles** while maintaining **60 FPS navigation** through advanced rendering techniques.

### Vision Statement

> "Load a 500MB IFC file, see first geometry in 2 seconds, navigate smoothly through millions of objects, and query any element instantly."

### Key Differentiators

| Feature | Typical Web Viewer | IFC-Lite Viewer |
|---------|-------------------|-----------------|
| Max model size | 50-100MB | **1GB+** |
| Max triangles | 1-5M | **50M+** |
| First paint | 10-30s | **<2s** |
| Navigation FPS | 15-30 | **60 stable** |
| Memory (100MB IFC) | 2-4GB | **<800MB** |
| Mobile support | Limited | **Full** |

---

## Part 1: Architecture Overview

### 1.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │   Toolbar   │ │  Hierarchy  │ │ Properties  │ │    3D Viewport      │   │
│  │             │ │    Tree     │ │   Panel     │ │                     │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION LAYER                                 │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   │
│  │  ViewerEngine   │ │  SelectionMgr   │ │      QueryInterface         │   │
│  │                 │ │                 │ │                             │   │
│  │  - Camera       │ │  - Pick         │ │  - Fluent API               │   │
│  │  - Controls     │ │  - Highlight    │ │  - SQL                      │   │
│  │  - Annotations  │ │  - Isolate      │ │  - Spatial                  │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RENDERING LAYER                                   │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   │
│  │  SceneGraph     │ │   LODManager    │ │     CullingSystem           │   │
│  │                 │ │                 │ │                             │   │
│  │  - Nodes        │ │  - LOD Levels   │ │  - Frustum                  │   │
│  │  - Transforms   │ │  - Screen-size  │ │  - Occlusion                │   │
│  │  - Batches      │ │  - Distance     │ │  - Small-feature            │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   │
│  │ InstanceManager │ │  MaterialSystem │ │     RenderPipeline          │   │
│  │                 │ │                 │ │                             │   │
│  │  - Batching     │ │  - PBR          │ │  - WebGPU                   │   │
│  │  - Transforms   │ │  - Transparency │ │  - Deferred                 │   │
│  │  - Culling      │ │  - Override     │ │  - Post-process             │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                       │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   │
│  │ StreamingLoader │ │  GeometryCache  │ │      IfcDataStore           │   │
│  │                 │ │                 │ │                             │   │
│  │  - Progressive  │ │  - GPU buffers  │ │  - Entities                 │   │
│  │  - Priority     │ │  - LOD meshes   │ │  - Properties               │   │
│  │  - Background   │ │  - Eviction     │ │  - Relationships            │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              IFC-LITE CORE                                  │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   │
│  │    IfcParser    │ │   IfcQuery      │ │     GeometryProcessor       │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Performance Targets

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PERFORMANCE TARGETS                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LOADING                                                                    │
│  ════════                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ File Size    │ First Paint │ Full Load │ Memory Peak │ Final Memory │   │
│  ├──────────────┼─────────────┼───────────┼─────────────┼──────────────┤   │
│  │    10 MB     │    <500ms   │    <3s    │    200MB    │    150MB     │   │
│  │    50 MB     │    <1s      │    <10s   │    600MB    │    400MB     │   │
│  │   100 MB     │    <2s      │    <20s   │    1GB      │    700MB     │   │
│  │   500 MB     │    <3s      │    <60s   │    2GB      │    1.5GB     │   │
│  │    1 GB      │    <5s      │    <120s  │    3GB      │    2GB       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  NAVIGATION                                                                 │
│  ══════════                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Triangles    │ Target FPS  │ Frame Time │ Draw Calls  │ GPU Memory  │   │
│  ├──────────────┼─────────────┼────────────┼─────────────┼─────────────┤   │
│  │    1M        │    60       │   <16ms    │    <100     │    100MB    │   │
│  │    5M        │    60       │   <16ms    │    <200     │    400MB    │   │
│  │   10M        │    60       │   <16ms    │    <500     │    800MB    │   │
│  │   50M        │    30-60    │   <33ms    │   <1000     │    2GB      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  INTERACTION                                                                │
│  ═══════════                                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Operation              │ Target Latency │ Notes                     │   │
│  ├────────────────────────┼────────────────┼───────────────────────────┤   │
│  │ Object pick            │     <50ms      │ GPU-based picking         │   │
│  │ Property lookup        │     <10ms      │ Cached in memory          │   │
│  │ Highlight selection    │     <16ms      │ Single frame              │   │
│  │ Isolate selection      │    <100ms      │ Visibility update         │   │
│  │ Section plane update   │     <16ms      │ GPU clipping              │   │
│  │ Measurement            │     <50ms      │ Snap to geometry          │   │
│  │ Search (by name)       │    <100ms      │ Indexed search            │   │
│  │ Filter (by property)   │    <200ms      │ Columnar scan             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Technology Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TECHNOLOGY STACK                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RENDERING                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Primary:   WebGPU (Chrome 113+, Firefox 127+, Safari 18+)          │   │
│  │  Fallback:  WebGL 2.0 (98% browser coverage)                        │   │
│  │  Shaders:   WGSL (WebGPU), GLSL ES 3.0 (WebGL)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  FRAMEWORK                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  UI:        React 19 + Zustand (state management)                   │   │
│  │  Styling:   Tailwind CSS + Radix UI (accessible components)         │   │
│  │  Build:     Vite + TypeScript 5.5                                   │   │
│  │  Testing:   Vitest + Playwright                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  DATA                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Parser:    IFC-Lite (streaming)                                 │   │
│  │  Query:     IFC-Lite Query + DuckDB-WASM (optional)                 │   │
│  │  Storage:   IndexedDB (model cache), OPFS (large files)             │   │
│  │  Workers:   Dedicated workers for parsing, LOD generation           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  OPTIONAL DEPENDENCIES                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  meshoptimizer-wasm:  LOD generation, mesh simplification           │   │
│  │  draco3d-wasm:        Mesh compression for caching                  │   │
│  │  recast-wasm:         Navigation mesh generation                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.4 Key Innovations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          KEY INNOVATIONS                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. PROGRESSIVE STREAMING ARCHITECTURE                                      │
│  ────────────────────────────────────────                                   │
│  - Parse → Triangulate → Upload in pipeline (no blocking)                  │
│  - Priority queue based on screen-space size                               │
│  - Background LOD generation while user navigates                          │
│                                                                             │
│  2. HIERARCHICAL INSTANCING                                                 │
│  ─────────────────────────────                                              │
│  - Automatic detection of repeated geometry (doors, windows, columns)      │
│  - Multi-level instancing (type → occurrence → placement)                  │
│  - Instance culling on GPU via compute shader                              │
│                                                                             │
│  3. HYBRID LOD SYSTEM                                                       │
│  ────────────────────────                                                   │
│  - Screen-space error metric (not distance-based)                          │
│  - Mesh simplification for unique geometry                                 │
│  - Billboard impostors for distant objects                                 │
│  - Bounding box proxies for very distant/small objects                     │
│                                                                             │
│  4. GPU-DRIVEN RENDERING                                                    │
│  ────────────────────────                                                   │
│  - Indirect draw calls (single draw for all instances)                     │
│  - GPU frustum culling via compute shader                                  │
│  - GPU occlusion culling (hierarchical Z-buffer)                           │
│  - Bindless textures (where supported)                                     │
│                                                                             │
│  5. SMART MEMORY MANAGEMENT                                                 │
│  ────────────────────────────                                               │
│  - Out-of-core streaming for huge models                                   │
│  - LRU cache eviction based on visibility                                  │
│  - Compressed GPU buffers (quantized positions/normals)                    │
│  - Shared geometry atlas for small objects                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.5 User Experience Goals

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        USER EXPERIENCE GOALS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LOADING EXPERIENCE                                                         │
│  ══════════════════                                                         │
│                                                                             │
│  0s        1s        2s        3s        5s        10s       30s            │
│  │         │         │         │         │         │         │             │
│  ├─────────┤         │         │         │         │         │             │
│  │ Skeleton│         │         │         │         │         │             │
│  │ UI      │         │         │         │         │         │             │
│  │         ├─────────┤         │         │         │         │             │
│  │         │ First   │         │         │         │         │             │
│  │         │ objects │         │         │         │         │             │
│  │         │ visible │         │         │         │         │             │
│  │         │         ├─────────┴─────────┤         │         │             │
│  │         │         │ Progressive fill  │         │         │             │
│  │         │         │ (largest first)   │         │         │             │
│  │         │         │                   ├─────────┴─────────┤             │
│  │         │         │                   │ LOD refinement    │             │
│  │         │         │                   │ (background)      │             │
│  │         │         │                   │                   ├─────────────│
│  │         │         │                   │                   │ Full detail │
│  ▼         ▼         ▼                   ▼                   ▼             │
│                                                                             │
│  User can START NAVIGATING after ~2 seconds (100MB file)                   │
│                                                                             │
│  ───────────────────────────────────────────────────────────────────────   │
│                                                                             │
│  NAVIGATION EXPERIENCE                                                      │
│  ═════════════════════                                                      │
│                                                                             │
│  - Orbit/pan/zoom feels instant (60 FPS)                                   │
│  - No "pop-in" - smooth LOD transitions                                    │
│  - First-person walkthrough mode available                                 │
│  - Momentum-based inertia for smooth stops                                 │
│  - Touch gestures fully supported                                          │
│                                                                             │
│  ───────────────────────────────────────────────────────────────────────   │
│                                                                             │
│  INTERACTION EXPERIENCE                                                     │
│  ══════════════════════                                                     │
│                                                                             │
│  - Click on any object → instant highlight + properties                    │
│  - Hover shows element type tooltip                                        │
│  - Double-click → zoom to fit selection                                    │
│  - Right-click context menu with common actions                            │
│  - Multi-select with Ctrl+click or box select                              │
│  - Search finds objects as you type                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.6 Competitive Analysis

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       COMPETITIVE ANALYSIS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│              │ IFC-Lite   │ ThatOpen  │ xBIM       │ Speckle   │ Autodesk  │
│              │ Viewer     │ Viewer    │ WebUI      │ Viewer    │ Viewer    │
│  ────────────┼────────────┼───────────┼────────────┼───────────┼───────────│
│  Max file    │ 1GB+       │ ~100MB    │ ~200MB     │ ~500MB    │ ~200MB    │
│  First paint │ <2s        │ 5-10s     │ 10-20s     │ 3-5s      │ 5-15s     │
│  60 FPS at   │ 10M tri    │ 1-2M tri  │ 2-3M tri   │ 5M tri    │ 2-3M tri  │
│  Mobile      │ ✓          │ Limited   │ ✗          │ ✓         │ Limited   │
│  Offline     │ ✓          │ ✓         │ ✗          │ ✗         │ ✗         │
│  Open source │ ✓ MIT      │ ✓ MIT     │ ✓ CDDL     │ ✓ Apache  │ ✗         │
│  WebGPU      │ ✓          │ ✗         │ ✗          │ ✗         │ ✗         │
│  IFC native  │ ✓          │ ✓         │ ✓          │ Convert   │ Convert   │
│  ────────────┼────────────┼───────────┼────────────┼───────────┼───────────│
│  Unique      │ Streaming  │ Fragments │ Server     │ Cloud     │ Cloud     │
│  approach    │ + GPU LOD  │ format    │ processing │ platform  │ platform  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

*Continue to Part 2: Rendering Pipeline*
