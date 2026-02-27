<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at https://mozilla.org/MPL/2.0/. -->

# Research: Porting TopologicPy to ifc-lite

> Non-Manifold Topology (NMT) for spatial reasoning in the browser, without OpenCASCADE.

## Executive Summary

[TopologicPy](https://github.com/wassimj/topologicpy) is a Python library for
non-manifold topology (NMT) in AEC. It enables spatial queries like "which rooms
share this wall?" or "find all spaces adjacent to the corridor." It currently
depends on a C++ core (TopologicCore) that wraps OpenCASCADE (OCC), making it
slow (~100-200x slower than native alternatives) and impossible to run in the
browser.

**Key finding**: For IFC-based spatial reasoning — the primary ifc-lite use
case — OCC is unnecessary. Adjacency information is already encoded in IFC
relationships (`IfcRelSpaceBoundary`, `IfcRelAggregates`, etc.). TopologicPy's
own `Graph.ByIFCFile()` method already bypasses OCC entirely.

**Proposed approach**: Clean-room reimplementation of the NMT data structure in
Rust/WASM with a TypeScript graph engine, targeting ~7,000-12,000 lines for ~80%
of TopologicPy's value at 100-1000x the speed, running natively in the browser.

---

## 1. TopologicPy Architecture

### 1.1 Three-Layer Stack

```
topologicpy (Python)     ~80,000 lines across 33 modules
       │
       ▼
topologic_core (C++)     ~13,000 lines via pybind11
       │
       ▼
OpenCASCADE 7.8          ~4M lines B-rep kernel
```

### 1.2 Module Inventory (33 modules, ~80K lines Python)

| Module | Lines | Priority | OCC Dependency | Notes |
|--------|-------|----------|---------------|-------|
| **Graph.py** | 19,909 | CRITICAL | Low (~20/130 methods) | Spatial graph engine. `Graph.ByIFCFile()` bypasses OCC entirely |
| **Topology.py** | 12,993 | CRITICAL | High (~130/157 methods) | Abstract superclass. Boolean ops all OCC |
| **Wire.py** | 6,716 | HIGH | Low (1 core call) | Shape generators, 95% pure math |
| **Cell.py** | 4,466 | HIGH | High (13 direct core calls) | 3D solid volumes |
| **Face.py** | 4,398 | HIGH | Medium (~10 core calls) | Planar faces 80% portable |
| **Vertex.py** | 2,656 | HIGH | Low (1 core call) | Trivial: just `ByCoordinates(x,y,z)` |
| **Shell.py** | 2,439 | MEDIUM | High (6 direct core calls) | B-rep shell sewing |
| **Dictionary.py** | 1,872 | MEDIUM | Low | Wrapper around HashMap |
| **Edge.py** | 1,866 | HIGH | Low (3 core calls) | Line segment, 100% portable |
| **Cluster.py** | 1,759 | LOW | High | Collection type |
| **CellComplex.py** | 1,607 | HIGH | High (11 direct core calls) | Multi-cell assemblies |
| **Vector.py** | 1,364 | LOW | None | 97% pure Python, use `nalgebra` |
| **Helper.py** | 864 | LOW | None | Pure Python utilities |
| **Matrix.py** | 616 | LOW | None | Pure Python, use `nalgebra` |
| **Color.py** | 602 | SKIP | None | Visualization only |
| **BVH.py** | 568 | LOW | None | ifc-lite already has BVH |
| **Grid.py** | 568 | LOW | High | Parametric face evaluation |
| **CSG.py** | 391 | LOW | High | ifc-lite has `csgrs` |
| **Context.py** | 83 | LOW | None | Trivial wrapper |
| **Aperture.py** | 73 | LOW | None | Trivial wrapper |
| EnergyModel.py | 4,131 | SKIP | - | Domain-specific integration |
| Honeybee.py | 3,119 | SKIP | - | Domain-specific integration |
| Sun.py | 1,797 | SKIP | - | Domain-specific integration |
| Plotly.py | 9,204 | SKIP | - | Visualization |
| ANN.py | 2,057 | SKIP | - | ML integration |
| GA.py | 1,254 | SKIP | - | ML integration |
| PyG.py | 972 | SKIP | - | ML integration |
| Speckle.py | 590 | SKIP | - | Speckle integration |
| Neo4j.py | 531 | SKIP | - | DB integration |
| Kuzu.py | 490 | SKIP | - | DB integration |
| ShapeGrammar.py | 422 | SKIP | - | Experimental |
| Polyskel.py | 332 | SKIP | - | Nice-to-have |
| BIM/ | stub | SKIP | - | Incomplete in TopologicPy |

### 1.3 C++ Core (TopologicCore) — What OCC Actually Does

TopologicCore is a thin wrapper around OCC's `TopoDS_Shape` hierarchy:

| Topologic Type | OCC Type | OCC Header |
|---------------|----------|------------|
| Vertex | `TopoDS_Vertex` | `BRep_Tool::Pnt()` |
| Edge | `TopoDS_Edge` | `BRep_Tool::Curve()` |
| Wire | `TopoDS_Wire` | `BRepBuilderAPI_MakeWire` |
| Face | `TopoDS_Face` | `BRep_Tool::Surface()` |
| Shell | `TopoDS_Shell` | `BRepBuilderAPI_Sewing` |
| Cell | `TopoDS_Solid` | `BRepBuilderAPI_MakeSolid` |
| CellComplex | `TopoDS_CompSolid` | `BOPAlgo_MakerVolume` |
| Cluster | `TopoDS_Compound` | `BRep_Builder::MakeCompound` |

OCC provides four categories of functionality:

1. **Topology construction** — Sewing faces into shells/cells (`Shell.ByFaces`,
   `Cell.ByFaces`, `CellComplex.ByFaces/ByCells`)
2. **Topology traversal** — Walking the data structure (`.Edges()`, `.Faces()`,
   `.Vertices()`, `.ExternalBoundary()`, `.InternalBoundaries()`)
3. **Boolean operations** — Union, Difference, Intersect, Merge, Slice, Impose,
   Imprint, XOR (via `BOPAlgo_CellsBuilder`, `BRepAlgoAPI_*`)
4. **Geometric queries** — Area, Volume, CenterOfMass, Containment, Distance
   (via `BRepGProp`, `BRepClass3d_SolidClassifier`, `BRepExtrema_DistShapeShape`)

---

## 2. What ifc-lite Already Has

| Capability | ifc-lite Component | Replaces |
|-----------|-------------------|----------|
| IFC parsing | `ifc-lite-core` (Rust, 1,259 MB/s) | IfcOpenShell |
| 3D CSG booleans | `csgrs` crate | OCC `BOPAlgo_*` (partially) |
| 2D booleans | `i_overlay` crate | OCC 2D operations |
| Triangulation | `earcutr` crate | OCC `BRepMesh` |
| Linear algebra | `nalgebra` crate | numpy/OCC `gp_*` |
| BVH spatial index | Already in geometry pipeline | TopologicPy `BVH.py` |
| Relationship graph | Entity relationship traversal | N/A |
| WASM compilation | Full pipeline | N/A (TopologicPy can't) |

---

## 3. Critical Finding: `Graph.ByIFCFile()` Bypasses OCC

The most valuable TopologicPy operation for AEC — building spatial adjacency
graphs from IFC files — **already works without OCC**. In `Graph.py` line 4053,
`Graph.ByIFCFile()` builds the graph purely from IFC relationships:

- `IfcRelAggregates` — spatial containment hierarchy
- `IfcRelContainedInSpatialStructure` — elements in spaces
- `IfcRelSpaceBoundary` — space-to-element adjacency (the key one)
- `IfcRelVoidsElement` — openings in walls
- `IfcRelFillsElement` — doors/windows filling openings
- `IfcRelConnectsPathElements` — wall-to-wall connections

This means ifc-lite can implement the spatial graph engine **without any
geometric kernel at all** — just by traversing IFC relationships that it already
parses.

---

## 4. OCC Dependency Surface — Complete Inventory

### 4.1 Direct `topologic_core` Hooks (All Files)

These are the exact C++ functions called from Python:

**Construction (HARD to replace — need B-rep kernel):**
- `topologic.Vertex.ByCoordinates(x, y, z)` — trivial
- `topologic.Edge.ByStartVertexEndVertex(sv, ev)` — trivial
- `topologic.Wire.ByEdges(edgeList)` — ordered edge chain
- `topologic.Face.ByExternalBoundary(wire)` — planar face from wire
- `topologic.Face.ByExternalInternalBoundaries(eb, ib, tol)` — face with holes
- `topologic.Shell.ByFaces(faceList, tol)` — sew faces into shell
- `topologic.Cell.ByFaces(faceList, tol)` — sew faces into solid
- `topologic.Cell.ByShell(shell)` — solid from closed shell
- `topologic.Cell.ByShells(ext, int)` — solid with internal voids
- `topologic.CellComplex.ByCells(cells, tol)` — merge cells sharing faces
- `topologic.CellComplex.ByFaces(faceList, tol)` — `BOPAlgo_MakerVolume`

**Traversal (EASY to replace — pure data structure walk):**
- `.Vertices(host, list)`, `.Edges(host, list)`, `.Wires(host, list)`
- `.Faces(host, list)`, `.Shells(host, list)`, `.Cells(host, list)`
- `.CellComplexes(host, list)`
- `.ExternalBoundary()`, `.InternalBoundaries(list)`
- `.NonManifoldFaces(list)`
- `.SuperTopologies(host, list)` — upward navigation
- `.IsClosed()`

**Boolean Operations (HARD — need CSG engine):**
- `.Union(other, transferDictionary)` — `BRepAlgoAPI_Fuse`
- `.Difference(other, transferDictionary)` — `BRepAlgoAPI_Cut`
- `.Intersect(other, transferDictionary)` — `BRepAlgoAPI_Common`
- `.Merge(other, transferDictionary)` — `BRepAlgoAPI_Fuse` (same as Union)
- `.Slice(tool, transferDictionary)` — `BOPAlgo_CellsBuilder`
- `.Impose(tool, transferDictionary)` — `BOPAlgo_CellsBuilder`
- `.Imprint(tool, transferDictionary)` — `BOPAlgo_CellsBuilder`
- `.XOR(other, transferDictionary)` — `BOPAlgo_CellsBuilder`
- `.Divide(tool)` — `BOPAlgo_CellsBuilder`
- `Topology.SelfMerge()` — `BOPAlgo_CellsBuilder` on self

**Geometric Queries (MODERATE — computational geometry):**
- `topologic.FaceUtility.Area(face)` — triangle sum
- `topologic.FaceUtility.NormalAtParameters(face, u, v)` — cross product
- `topologic.FaceUtility.Triangulate(face)` — ear clipping
- `topologic.CellUtility.Volume(cell)` — signed tetrahedra
- `topologic.CellUtility.Contains(cell, vertex, tol)` — ray casting
- `topologic.EdgeUtility.Length(edge)` — distance formula
- `topologic.TopologyUtility.Translate/Rotate/Scale/Transform` — affine transforms

### 4.2 Methods Using Boolean Operations (Cannot Port Without CSG)

These methods require OCC boolean operations and would need `csgrs` or similar:

| Method | Boolean Used |
|--------|-------------|
| `Cell.CHS`, `Cell.RHS`, `Cell.SHS`, `Cell.Tube` | Difference (hollow sections) |
| `Cell.ByOffset` | Face offset + boolean |
| `CellComplex.Prism` (subdivided) | Slice (grid planes) |
| `CellComplex.Voronoi` | Slice |
| `Shell.ByDisjointFaces` | Slice + Difference |
| `Shell.ByThickenedWire` | Slice |
| `Shell.GoldenRectangle` | Slice |
| `Shell.Voronoi` | Slice |
| `Topology.Difference/Union/Intersect/Merge/Slice/Impose/Imprint/XOR` | All booleans |

### 4.3 Pattern: Parametric Shapes Are Pure Math

A key finding is that nearly ALL parametric shape constructors (Sphere, Cone,
Cylinder, Torus, Dodecahedron, Icosahedron, etc.) compute vertices and face
lists in pure Python math, then call `Cell.ByFaces()` or `Shell.ByFaces()` for
final assembly. If we implement `ByFaces()` in Rust, all these shapes come for
free.

---

## 5. Proposed Implementation

### 5.1 Rust NMT Data Structure (`ifc-lite-topology` crate)

```rust
// Core NMT arena — all topology entities stored in slot maps
// with bidirectional adjacency for non-manifold sharing
pub struct TopologyArena {
    vertices: SlotMap<VertexKey, VertexData>,    // [f64; 3]
    edges: SlotMap<EdgeKey, EdgeData>,           // (VertexKey, VertexKey)
    wires: SlotMap<WireKey, WireData>,           // Vec<EdgeKey> ordered
    faces: SlotMap<FaceKey, FaceData>,           // (WireKey ext, Vec<WireKey> holes)
    shells: SlotMap<ShellKey, ShellData>,        // Vec<FaceKey>
    cells: SlotMap<CellKey, CellData>,           // (ShellKey ext, Vec<ShellKey> voids)
    cell_complexes: SlotMap<CCKey, CCData>,      // Vec<CellKey>

    // NMT adjacency — the key difference from manifold topology
    // A face can belong to 2+ cells (shared wall between rooms)
    face_to_cells: HashMap<FaceKey, Vec<CellKey>>,
    edge_to_faces: HashMap<EdgeKey, Vec<FaceKey>>,
    vertex_to_edges: HashMap<VertexKey, Vec<EdgeKey>>,

    // Metadata (replaces TopologicPy's Dictionary system)
    dictionaries: HashMap<TopologyKey, HashMap<String, Value>>,
}
```

Estimated: **3,000-5,000 lines of Rust**

Required operations:
- Topology construction: `ByCoordinates`, `ByStartVertexEndVertex`, `ByEdges`,
  `ByExternalBoundary`, `ByFaces`, `ByShell`, `ByCells`
- Topology traversal: All `.Vertices()`, `.Edges()`, etc. + upward/downward navigation
- Geometric queries: Area, Volume, CenterOfMass, Containment, Normal, Distance
- Affine transforms: Translate, Rotate, Scale
- Serialization: BREP string, JSON

### 5.2 IFC-to-Topology Bridge (~1,000-2,000 lines)

Builds NMT structures directly from parsed IFC data:

```
IFC File → ifc-lite parser → Entity graph
                                  │
                    ┌─────────────┼─────────────┐
                    ▼             ▼              ▼
              IfcSpace      IfcWall        IfcRelSpaceBoundary
              → Cell        → Face(s)      → face_to_cells adjacency
```

Key insight: IFC already encodes topology:
- `IfcSpace` → Cell (room volume)
- `IfcWall`/`IfcSlab` surface → Face (boundary between spaces)
- `IfcRelSpaceBoundary` → face-to-cell adjacency (the NMT sharing)
- `IfcRelAggregates` → spatial hierarchy
- `IfcRelConnectsPathElements` → wall connectivity

### 5.3 Graph Engine (`@ifc-lite/topology-graph`, TypeScript)

```
TopologyArena (WASM) → Dual Graph → Spatial Queries
                           │
              Nodes = Cells (rooms)
              Edges = Shared Faces (walls)
              Weights = Face area, distance, etc.
```

Estimated: **3,000-5,000 lines of TypeScript**

Port from `Graph.py` (97% already pure Python, trivial to convert):
- Graph construction: `ByTopology`, `ByIFCModel` (replaces `ByIFCFile`)
- Path finding: Dijkstra, A*
- Centrality: Betweenness, Closeness, Degree, Eigenvector, PageRank
- Analysis: Connected components, MST, Diameter, Density
- Graph booleans: Union, Intersect, Difference (pure graph ops)
- I/O: JSON, adjacency matrix

### 5.4 What We Skip (and Why)

| Category | Reason |
|----------|--------|
| Full OCC boolean operations | `csgrs` covers basic CSG; full B-rep booleans are 500K+ lines |
| Curved geometry (NURBS/BSpline) | IFC buildings are 99% planar geometry |
| Integration modules (12 total) | Domain-specific, not core topology |
| Parametric shape generators | Nice-to-have; users create geometry in IFC authoring tools |
| `Topology.Spin`, `Topology.Sweep` | Requires general sweeping kernel |

---

## 6. Implementation Phases

### Phase 1: Rust NMT Core (3,000-5,000 lines)

New crate: `crates/ifc-lite-topology/`

1. Arena-based NMT data structure with slot maps
2. Construction: Vertex, Edge, Wire, Face, Shell, Cell, CellComplex
3. Traversal: Upward/downward navigation, boundary queries
4. Geometric queries: Area, Volume, Normal, CenterOfMass, Containment
5. Affine transforms: Translate, Rotate, Scale
6. WASM bindings via `wasm-bindgen`

### Phase 2: IFC-to-Topology Bridge (1,000-2,000 lines)

Extend existing IFC parser:

1. Extract spatial structure from `IfcRelAggregates`
2. Build Cells from `IfcSpace` geometry (already parsed by ifc-lite)
3. Build face-to-cell adjacency from `IfcRelSpaceBoundary`
4. Handle `IfcRelVoidsElement` / `IfcRelFillsElement` for apertures
5. Handle `IfcRelConnectsPathElements` for wall connectivity

### Phase 3: TypeScript Graph Engine (3,000-5,000 lines)

New package: `packages/topology-graph/`

1. Dual graph from TopologyArena (nodes=cells, edges=shared faces)
2. Path finding (Dijkstra, A*)
3. Centrality measures
4. Connected components, MST
5. `ByIFCModel()` — graph from IFC relationships (port of `Graph.ByIFCFile`)

### Total Estimate

| Component | Lines | Replaces |
|-----------|-------|----------|
| Rust NMT Core | 3,000-5,000 | TopologicCore (13K C++) + OCC (4M C++) |
| IFC Bridge | 1,000-2,000 | IfcOpenShell dependency |
| Graph Engine | 3,000-5,000 | Graph.py (20K Python) |
| **Total** | **7,000-12,000** | **93,000 lines (TopologicPy + TopologicCore)** |

---

## 7. License Considerations

| Component | License | Constraint |
|-----------|---------|-----------|
| TopologicPy | GPLv3 | Cannot copy code |
| TopologicCore | AGPLv3 | Cannot copy code |
| ifc-lite | MPL-2.0 | Must maintain |
| OpenCASCADE | LGPL-2.1 | Irrelevant (not using) |

**Strategy**: Clean-room reimplementation. Study the API surface and behavior,
then implement from scratch in Rust/TypeScript. No code copying. The NMT
concepts (shared faces between cells, dual graphs) are well-established
computational topology — not patentable or copyrightable.

---

## 8. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Face sewing without OCC | HIGH | For IFC, faces come pre-defined; use tolerance-based vertex merging |
| Boolean operations limited | MEDIUM | `csgrs` handles basic CSG; defer advanced booleans |
| CellComplex construction | HIGH | For IFC, cell complexes are implicit in spatial structure |
| Curved geometry unsupported | LOW | IFC buildings are overwhelmingly planar |
| API compatibility | LOW | Not a goal — we design for ifc-lite's TypeScript API |

---

## 9. Appendix: Direct Core Call Inventory by File

### Cell.py (13 direct core calls)

| Method | Core Function |
|--------|--------------|
| `Cell.ByFaces` | `topologic.Cell.ByFaces()` |
| `Cell.ByShell` | `topologic.Cell.ByShell()` |
| `Cell.ByShells` | `topologic.Cell.ByShells()` |
| `Cell.ContainmentStatus` | `topologic.CellUtility.Contains()` |
| `Cell.Volume` | `topologic.CellUtility.Volume()` |
| `Cell.ExternalBoundary` | `cell.ExternalBoundary()` |
| `Cell.InternalBoundaries` | `cell.InternalBoundaries()` |
| `Cell.Edges` | `cell.Edges(None, edges)` |
| `Cell.Faces` | `cell.Faces(None, faces)` |
| `Cell.Shells` | `cell.Shells(None, shells)` |
| `Cell.Vertices` | `cell.Vertices(None, vertices)` |
| `Cell.Wires` | `cell.Wires(None, wires)` |
| `Cell.Decompose` | `aFace.Cells(cell, cells)` |

### CellComplex.py (11 direct core calls)

| Method | Core Function |
|--------|--------------|
| `CellComplex.ByCells` | `topologic.CellComplex.ByCells()` |
| `CellComplex.ByFaces` | `topologic.CellComplex.ByFaces()` |
| `CellComplex.ExternalBoundary` | `cellComplex.ExternalBoundary()` |
| `CellComplex.InternalFaces` | `cellComplex.InternalBoundaries()` |
| `CellComplex.NonManifoldFaces` | `cellComplex.NonManifoldFaces()` |
| `CellComplex.Cells` | `cellComplex.Cells(None, cells)` |
| `CellComplex.Edges` | `cellComplex.Edges(None, edges)` |
| `CellComplex.Faces` | `cellComplex.Faces(None, faces)` |
| `CellComplex.Vertices` | `cellComplex.Vertices(None, vertices)` |
| `CellComplex.Wires` | `cellComplex.Wires(None, wires)` |
| `CellComplex.Decompose` | `aFace.Cells(cc, cells)` |

### Shell.py (6 direct core calls)

| Method | Core Function |
|--------|--------------|
| `Shell.ByFaces` | `topologic.Shell.ByFaces()` |
| `Shell.IsClosed` | `shell.IsClosed()` |
| `Shell.Edges` | `shell.Edges(None, edges)` |
| `Shell.Faces` | `shell.Faces(None, faces)` |
| `Shell.Vertices` | `shell.Vertices(None, vertices)` |
| `Shell.Wires` | `shell.Wires(None, wires)` |

### Topology.py (~130 core calls — key ones)

| Category | Methods | Core Function |
|----------|---------|--------------|
| Boolean | `Difference`, `Union`, `Intersect`, `Merge`, `Slice`, `Impose`, `Imprint`, `XOR` | `BOPAlgo_CellsBuilder`, `BRepAlgoAPI_*` |
| Transform | `Translate`, `Rotate`, `Scale`, `Transform` | `TopologyUtility.*` |
| Query | `Type`, `TypeAsString`, `IsInstance` | Type checks |
| Navigation | `AdjacentTopologies`, `SuperTopologies`, `SubTopologies` | `TopExp_Explorer`, ancestor maps |
| I/O | `ByBREPString`, `BREPString`, `ByOCCTShape` | OCC serialization |

### Graph.py (~20 core calls)

| Method | Core Function |
|--------|--------------|
| `Graph.ByVerticesEdges` | `topologic.Graph.ByVerticesEdges()` |
| `Graph.AddVertex` | `topologic.Graph.AddVertex()` |
| `Graph.Vertices` | `graph.Vertices()` |
| `Graph.Edges` | `graph.Edges()` |
| `Graph.AdjacentVertices` | `topologic.Graph.VerticesAtCoordinates()` |
| `Graph.ByTopology` | `topologic.Graph.ByTopology()` |
| **`Graph.ByIFCFile`** | **NONE — pure Python IFC parsing** |

### Vertex.py, Edge.py, Wire.py, Face.py

| Method | Core Function |
|--------|--------------|
| `Vertex.ByCoordinates` | `topologic.Vertex.ByCoordinates()` |
| `Vertex.X/Y/Z` | `topologic.VertexUtility.X/Y/Z()` |
| `Edge.ByStartVertexEndVertex` | `topologic.Edge.ByStartVertexEndVertex()` |
| `Edge.Length` | `topologic.EdgeUtility.Length()` |
| `Wire.ByEdges` | `topologic.Wire.ByEdges()` |
| `Face.ByExternalBoundary` | `topologic.Face.ByExternalBoundary()` |
| `Face.ByExternalInternalBoundaries` | `topologic.Face.ByExternalInternalBoundaries()` |
| `Face.Area` | `topologic.FaceUtility.Area()` |
| `Face.Normal` | `topologic.FaceUtility.NormalAtParameters()` |
| `Face.Triangulate` | `topologic.FaceUtility.Triangulate()` |
