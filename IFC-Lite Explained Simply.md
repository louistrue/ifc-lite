# IFC-Lite Explained Simply

## What's the Problem We're Solving?

IFC files are like **giant XML files for buildings**. They contain everything: walls, doors, windows, pipes, properties, relationships... A hospital model can be 500MB with millions of objects.

Current tools to view these files in a browser are either:
- **Slow** (wait 30 seconds to see anything)
- **Memory hungry** (crash your browser)
- **Server-dependent** (need backend processing)

We want to open a huge IFC file **directly in the browser**, see geometry in **2-5 seconds** (depending on complexity), and navigate smoothly at **60 FPS**.

---

## IFC-Lite Core: The Data Engine

Think of it as a **specialized database for building data** that runs in your browser.

### The Key Insight

Instead of parsing IFC into JavaScript objects (slow, memory-heavy), we use **columnar storage** - like a spreadsheet:

```
Traditional (slow):
─────────────────────
wall1 = { id: 1, name: "Wall-A", height: 3.0, material: "concrete" }
wall2 = { id: 2, name: "Wall-B", height: 2.8, material: "brick" }
wall3 = { id: 3, name: "Wall-C", height: 3.0, material: "concrete" }
... 100,000 more objects

Columnar (fast):
─────────────────────
ids:       [1, 2, 3, ...]           ← Uint32Array
heights:   [3.0, 2.8, 3.0, ...]     ← Float32Array  
materials: [0, 1, 0, ...]           ← indices into string table
```

**Why is columnar faster?**
- Finding all walls taller than 2.5m? Just scan the `heights` array
- CPU cache loves sequential memory access
- Typed arrays are 10-100x faster than object properties
- Can send directly to GPU without conversion

### The Three Ways to Query

```typescript
// 1. Fluent API - Easy and readable
const fireWalls = await model.walls()
  .whereProperty('Pset_WallCommon', 'FireRating', '>=', 60)
  .execute();

// 2. SQL - Full power for complex queries
const report = await model.sql(`
  SELECT type, COUNT(*), SUM(area) 
  FROM elements 
  GROUP BY type
`);

// 3. Graph - Navigate relationships
const door = model.entity(doorId);
const wall = door.fills();           // What wall is this door in?
const storey = wall.containedIn();   // What floor?
const building = storey.building();  // What building?
```

---

## IFC-Lite Viewer: The Visual Layer

The viewer makes the data **visible and interactive**. The hard part is handling **millions of triangles** smoothly.

### Problem: Too Many Objects

A building has 50,000 objects. Drawing each one separately = 50,000 draw calls = 5 FPS.

**Solution: Batching & Instancing**

```
Before (slow):
─────────────────────
draw(door1)  ← separate call
draw(door2)  ← separate call
draw(door3)  ← separate call
... 500 doors = 500 draw calls

After (fast):
─────────────────────
draw(doorGeometry, transforms[500])  ← ONE call draws all 500 doors
```

All 500 doors share the same geometry, just with different positions. One draw call instead of 500.

### Problem: Too Many Triangles

A detailed model has 50 million triangles. Even modern GPUs struggle.

**Solution: Level of Detail (LOD)**

```
Close up (< 10m):     Full detail      (10,000 triangles)
Medium (10-50m):      Simplified       (1,000 triangles)  
Far away (> 50m):     Bounding box     (12 triangles)
Very far:             Don't draw       (0 triangles)
```

We calculate which LOD to use based on **screen size** - if an object is only 5 pixels on screen, why render 10,000 triangles?

### Problem: Drawing Things You Can't See

**Solution: Culling**

```
Frustum culling:   Don't draw objects outside camera view
Occlusion culling: Don't draw objects hidden behind walls
Size culling:      Don't draw objects smaller than 1 pixel
```

This happens on the **GPU using compute shaders** - the GPU checks 100,000 objects in <1ms.

### Problem: Slow Loading

**Solution: Progressive Streaming**

```
0-1 sec:    Show skeleton UI, start parsing
1-2 sec:    Show building shape (floors, exterior walls)
2-5 sec:    Fill in details (user can already navigate!)
5-30 sec:   Load everything else in background
30+ sec:    Generate LODs, cache for next time
```

User doesn't wait for full load - they can start exploring after 2 seconds.

---

## The Data Flow

```
IFC File (500MB)
     │
     ▼
┌─────────────────┐
│  IFC-Lite Core  │ ← Streaming parser, columnar storage
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Geometry Store │ ← Triangulated meshes, instancing info
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   GPU Buffers   │ ← Uploaded to graphics card
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  WebGPU Render  │ ← 60 FPS with culling + LOD
└────────┬────────┘
         │
         ▼
    Your Screen
```

---

## Why WebGPU?

WebGL is like **OpenGL from 2010**. WebGPU is like **modern Vulkan/Metal**:

| Feature | WebGL | WebGPU |
|---------|-------|--------|
| Compute shaders | ❌ | ✅ |
| Indirect draw | Limited | ✅ |
| Bindless | ❌ | ✅ |
| Multi-threaded | ❌ | ✅ |

Compute shaders let us do **culling and LOD selection on the GPU** instead of slow JavaScript.

---

## Key Takeaways

1. **Columnar storage** = fast queries on big data
2. **Instancing** = draw thousands of similar objects in one call
3. **LOD** = show less detail for far/small objects
4. **GPU culling** = let the GPU decide what's visible
5. **Progressive loading** = show something fast, refine later
6. **Caching** = instant reload after first visit
7. **Performance tiers** = simple files load fast, complex files get more time

The goal: **make a 500MB IFC file feel like a 5MB one**.

*Note: Performance varies by file complexity (Tier 1/2/3). Simple architectural files load fastest; MEP-heavy files with complex geometry take longer.*