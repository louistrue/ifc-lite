# IFC-Lite Viewer: Part 4 - User Interface & Part 5 - Implementation Plan

## 4.1 UI Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TOOLBAR: [≡] [📂] [💾] │ [👆] [✋] [📐] [✂️] │ [🏠] [🎯] [👁] │ [⚙]        │
├────────────┬───────────────────────────────────────────────┬────────────────┤
│ HIERARCHY  │                   3D VIEWPORT                 │   PROPERTIES   │
│            │                                               │                │
│ 📁 Project │    ┌───────────────────────────────────┐     │  Type: IfcWall │
│  📁 Site   │    │                                   │     │  Name: Wall-01 │
│   📁 Bldg  │    │         [3D MODEL VIEW]           │     │                │
│    📁 L0   │    │                                   │     │  ▸ Pset_Common │
│     🧱 Wall│    │                                   │     │  ▸ Quantities  │
│     🚪 Door│    └───────────────────────────────────┘     │                │
│            │    [ViewCube]              [Scale Bar]       │                │
├────────────┴───────────────────────────────────────────────┴────────────────┤
│ STATUS: Ready │ 45,231 elements │ 2.3M triangles │ 60 FPS │ 847 MB         │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 4.2 Key UI Components

### Camera Controller

```typescript
class CameraController {
  // Orbit, pan, zoom with inertia
  orbit(deltaX: number, deltaY: number): void;
  pan(deltaX: number, deltaY: number): void;
  zoom(delta: number): void;
  
  // Animation
  zoomToFit(bounds: AABB, duration?: number): Promise<void>;
  
  // Modes
  enableFirstPerson(): void;
  enableOrbit(): void;
  
  // Touch support
  handleTouch(event: TouchEvent): void;
}
```

### Selection Manager

```typescript
class SelectionManager {
  select(ids: number | number[], mode?: 'single' | 'add' | 'toggle'): void;
  clear(): void;
  highlight(id: number | null): void;
  isolate(ids?: number[]): void;
  hide(ids?: number[]): void;
  showAll(): void;
  boxSelect(rect: Rect): Promise<void>;
}
```

### GPU Object Picker

```typescript
class ObjectPicker {
  // Pick at screen position
  pick(x: number, y: number): Promise<PickResult | null>;
  
  // Pick all in rectangle
  pickRect(rect: Rect): Promise<number[]>;
}

interface PickResult {
  expressId: number;
  position: Vec3;
  normal: Vec3;
  distance: number;
}
```

### Virtual Scrolling Tree

```typescript
// For 100K+ nodes without performance issues
const HierarchyTree: React.FC = () => {
  const virtualizer = useVirtualizer({
    count: flattenedNodes.length,
    estimateSize: () => 28,
    overscan: 20,
  });
  // ...
};
```

### Measurement Tool

```typescript
class MeasurementTool {
  mode: 'distance' | 'angle' | 'area' | 'height';
  
  placePoint(screenPos: Vec2): Promise<void>;
  
  // Snap to geometry
  snap(screenPos: Vec2): Promise<SnapResult | null>;
}
```

---

# Part 5: Implementation Plan

## 5.1 Development Phases

The viewer development follows a phased approach, building on the IFC-Lite core library.

## 5.2 Phase Details

### Phase 1: WebGPU Renderer

**Deliverables:**
- WebGPU device setup, basic triangle rendering
- Buffer management, shader system
- Camera controls, frustum culling (CPU)
- Basic material system, depth testing

**Exit Criteria:**
- Render 1M triangles at 60 FPS
- Orbit/pan/zoom working
- Object picking functional

### Phase 2: LOD & Instancing

**Deliverables:**
- GPU culling compute shader
- meshoptimizer integration, LOD generation
- Instance detection, batching
- Out-of-core streaming, memory management

**Exit Criteria:**
- Render 10M triangles at 60 FPS
- Handle 500MB IFC files
- Memory under 2GB for large models

### Phase 3: UI & Tools

**Deliverables:**
- React app shell, toolbar, layout
- Hierarchy tree (virtual scroll), selection
- Properties panel, filtering
- Measurement tools, section planes

**Exit Criteria:**
- Full UI functional
- All interaction modes working
- Touch support complete

### Phase 4: Polish & Launch

**Deliverables:**
- IndexedDB caching, fast reload
- WebGL fallback (optional)
- Performance optimization, testing
- Documentation, demo site, launch

**Exit Criteria:**
- Production ready
- Demo site live
- Documentation complete

---

## 5.3 Team Requirements

### Development Team

| Role | Allocation |
|------|------------|
| Senior Graphics Engineer | Lead |
| Frontend Developer | Support |
| UX Designer | As needed |
| DevOps | As needed |

---

## 5.4 Performance Milestones

### Loading Performance

| File Size | First Paint | Full Load | Memory |
|-----------|-------------|-----------|--------|
| 10 MB | <500ms | <3s | <200MB |
| 50 MB | <1s | <10s | <500MB |
| 100 MB | <2s | <20s | <800MB |
| 500 MB | <3s | <60s | <2GB |

### Rendering Performance

| Triangle Count | Target FPS | Draw Calls |
|----------------|------------|------------|
| 1M | 60 | <100 |
| 5M | 60 | <200 |
| 10M | 60 | <500 |
| 50M | 30-60 | <1000 |

### Interaction Latency

| Operation | Target |
|-----------|--------|
| Object pick | <50ms |
| Highlight | <16ms |
| Property lookup | <10ms |
| Zoom to fit | <100ms |

---

## 5.5 Technology Dependencies

### Required (Day 1)

- **IFC-Lite** - Core parsing and query
- **WebGPU** - Primary renderer (Chrome 113+, Safari 18+)
- **React 19** - UI framework
- **Vite** - Build tool

### Optional (Performance)

- **meshoptimizer-wasm** - LOD generation
- **draco3d-wasm** - Mesh compression
- **DuckDB-WASM** - SQL queries (from IFC-Lite)

### Fallback

- **WebGL 2.0** - For browsers without WebGPU

---

## 5.6 Demo Site Features

### Landing Page

- Hero with interactive 3D model
- File drop zone
- Sample model gallery
- Feature highlights

### Viewer Page

- Full viewer interface
- Share via URL
- Export options (glTF, images)
- Embed code generator

### Showcase Models

1. **Duplex Apartment** (1MB) - Quick demo
2. **Office Building** (10MB) - Medium complexity
3. **Hospital** (100MB) - Performance showcase
4. **Stadium** (500MB) - Stress test

---

## 5.7 Success Metrics

### Technical

- [ ] 60 FPS with 10M triangles
- [ ] First paint <2s for 100MB file
- [ ] Memory <2x file size
- [ ] Works on M1 MacBook Air

### User Experience

- [ ] 5-second time to first interaction
- [ ] Zero learning curve for basic navigation
- [ ] Instant property display on click
- [ ] Smooth transitions (no pop-in)

### Adoption

- [ ] 1000+ unique visitors in first month
- [ ] 10+ community contributions
- [ ] Integration in 3+ Ltplus products
- [ ] Featured on BuildingSMART

---

## 5.8 Combined Project Summary

### Development Approach

The IFC-Lite Core and Viewer are developed in sequence, with the Viewer building upon the Core library. Phases overlap to optimize development flow.

### Milestones

- **Core Alpha** → **Core v1.0** → **Viewer Alpha** → **Viewer v1.0**

### Strategic Value

1. **Product Portfolio Enhancement**
   - ifcrender.com → 10x faster
   - modelhealthcheck.com → Browser validation
   - All products → Embedded viewer

2. **Market Position**
   - Only WebGPU-based IFC viewer
   - Best-in-class performance
   - Open source leadership

3. **Educational Value**
   - BFH teaching integration
   - Clean, documented codebase
   - Reference implementation

---

**Recommendation: Proceed with phased development starting with IFC-Lite core, followed by Viewer.**
