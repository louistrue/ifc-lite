<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at https://mozilla.org/MPL/2.0/. -->

# Implementation Plan: `ifc-lite-topology` Rust Crate

## Approach: Clean-Room, Test-Driven Development

All code is original work under MPL-2.0. No code is copied from TopologicPy
(AGPL v3) or TopologicCore (AGPL v3). Implementation is based on published
computational topology algorithms and the documented API contract.

---

## Status

| Phase | Status | Tests |
|-------|--------|-------|
| 1 — Core NMT Data Structure | **Done** | 26 |
| 2 — Traversal | **Done** | 12 |
| 3 — Geometric Queries | **Done** | 12 |
| 4 — Transforms & Metadata | **Done** | 14 |
| 5 — Serialization | **Done** | 5 |
| 6 — Spatial Index & Builders | **Done** | 12 |
| 7 — Query & Analysis | **Done** | 10 |
| 8 — Graph Algorithms | **Done** | 17 |
| 9 — IFC Content/Aperture | **Done** | 4 |
| **Total** | | **109 + 1 doc-test** |

---

## Module Map

```
rust/topology/src/
├── lib.rs            Root module, public re-exports
├── keys.rs           SlotMap key types + TopologyKey enum + TopologyType
├── error.rs          Crate error types (thiserror)
├── arena.rs          TopologyArena — central owner of all entities
├── construction.rs   Low-level add_edge / add_wire / add_face / add_shell / add_cell
├── traversal.rs      Downward + upward traversal, adjacency, shared_faces
├── geometry.rs       Normals, area, volume, centroid, ray casting, triangulation
├── transform.rs      Translate, rotate, scale, 4×4 matrix transform
├── dictionary.rs     Typed key-value metadata (DictValue enum)
├── serialization.rs  JSON round-trip (ArenaSnapshot ↔ serde_json)
├── spatial.rs        Grid-based spatial hash, find_or_add_vertex, merge
├── builders.rs       High-level sewing constructors (make_box, sew_faces, etc.)
├── query.rs          SelectSubtopology, SharedTopologies, non-manifold detection
├── graph.rs          Dual graph, Dijkstra, BFS, centrality, MST
└── content.rs        IFC Content/Context/Aperture system
```

---

## Phase 1: Core NMT Data Structure + Construction

### Step 1: Arena + Type Hierarchy ✅
- `TopologyArena` with `SlotMap` storage for each topology type
- Key types: `VertexKey`, `EdgeKey`, `WireKey`, `FaceKey`, `ShellKey`, `CellKey`, `CellComplexKey`
- `TopologyKey` enum wrapping all key types
- `TopologyType` enum for runtime type discrimination

### Step 2: Construction Primitives ✅
- `add_vertex(x, y, z)` → `VertexKey`
- `add_edge(start, end)` → validates both vertices exist
- `add_wire(edges)` — ordered edge chain, auto-detects orientation
- `add_face(outer_wire)` / `add_face_with_holes(outer, inner_wires)`
- `add_shell(faces)`, `add_cell(shell)`, `add_cell_with_voids(outer, inners)`
- `add_cell_complex(cells)`

### Step 3: NMT Adjacency Index ✅
- Bidirectional maps: `vertex↔edges`, `edge↔wires`, `wire↔faces`, `face↔shells`, `shell↔cells`, `cell↔complexes`
- Non-manifold: a face can belong to 2+ cells (shared wall)
- An edge can belong to 2+ faces (shared boundary)

## Phase 2: Traversal ✅

### Step 4: Downward Traversal
- `edge_vertices`, `wire_vertices_ordered`, `wire_edges`
- `face_vertices`, `face_edges`, `face_outer_wire`, `face_inner_wires`
- `shell_faces`, `shell_edges`, `shell_vertices`
- `cell_faces`, `cell_edges`, `cell_vertices`
- `complex_cells`, `complex_faces`, `complex_edges`, `complex_vertices`

### Step 5: Upward Traversal
- `vertex_edges`, `edge_wires`, `wire_faces`, `face_shells`, `shell_cells`, `cell_complexes_of`

### Step 6: Adjacency + Boundary Queries
- `adjacent_faces_in_shell`, `adjacent_cells_in_complex`
- `shared_faces(cell_a, cell_b)` — NMT shared boundary detection
- `wire_is_closed`, `shell_is_closed`

## Phase 3: Geometric Queries ✅

### Step 7: Basic Metrics
- `edge_length` — Euclidean distance
- `face_area` — triangle fan summation
- `face_normal` — Newell's method
- `cell_volume` — signed tetrahedra method

### Step 8: Spatial Queries
- `face_centroid`, `cell_centroid` — geometric center
- `cell_contains(cell, point)` — ray casting with perturbation
- `face_contains_point(face, point)` — 2D projection + ray casting

### Step 9: Triangulation
- `triangulate_face` — projects to dominant plane, runs earcutr

## Phase 4: Transforms & Metadata ✅

### Step 10: Affine Transforms
- `translate(key, dx, dy, dz)` — all sub-vertices
- `rotate(key, origin, axis, angle)` — nalgebra Rotation3
- `scale(key, origin, sx, sy, sz)`
- `transform(key, matrix)` — arbitrary 4×4 Matrix4

### Step 11: Dictionary System
- `set_dictionary` / `get_dictionary` / `get_dictionary_mut` / `remove_dictionary`
- `DictValue`: Int, Double, String, List
- Attach metadata to any topology entity via `TopologyKey`

## Phase 5: Serialization ✅

### Step 12: JSON Serialization
- `to_json(arena)` / `from_json(json)` — full arena round-trip
- `ArenaSnapshot` with sub-snapshots for each entity type
- SlotMap keys mapped to sequential integer IDs for portability
- Includes dictionary metadata

## Phase 6: Spatial Index & Builders ✅

### Step 13: Spatial Hash Index
- `SpatialIndex` — grid-based spatial hash for O(1) tolerance queries
- `find_near`, `find_all_near`, `from_arena`
- `find_or_add_vertex` — merge-or-create for face sewing
- `merge_coincident_vertices` — rewrites edge references
- `find_vertex_near` — brute-force fallback

### Step 14: High-Level Builders
- `add_wire_by_vertices`, `add_face_by_vertices`, `add_face_by_coords`
- `sew_faces(face_coords, tolerance)` — tolerance-based vertex/edge sharing
- `add_cell_by_faces`, `add_cell_complex_by_cells` — with face deduplication for NMT
- `make_box(min, max)`, `make_adjacent_boxes` — convenience constructors

## Phase 7: Query & Analysis ✅

### Step 15: Type Utilities
- `topology_type`, `type_as_string`, `is_same`

### Step 16: Sub-topology Selection
- `select_sub_topology(host, selector_point, target_type)` — nearest entity of type
- `shared_topologies(a, b, type)` — intersection of sub-entities

### Step 17: Cell Complex Analysis
- `non_manifold_faces` — faces shared by 3+ cells (T-junctions)
- `internal_faces` — shared by exactly 2 cells (walls between rooms)
- `external_faces` — boundary faces (exterior envelope)

### Step 18: Geometry Utilities
- `deep_copy_face` — independent copy with new vertices/edges/wires
- `distance_point_to_face`, `distance_cell_to_cell`
- `distance_point_to_edge` — closest point on line segment

## Phase 8: Graph Algorithms ✅

### Step 19: Graph Data Structure
- `TopologyGraph` with nodes, edges, adjacency list
- `GraphNode` (topology_key + dictionary), `GraphEdge` (source, target, weight)
- `from_cell_complex` — dual graph (cells=nodes, shared faces=edges, weight=area)
- `from_vertices_edges` — general vertex-edge graph

### Step 20: Path Finding
- `shortest_path(source, target)` — Dijkstra with min-heap
- `shortest_path_unweighted(source, target)` — BFS hop-count

### Step 21: Graph Analysis
- `connected_components`, `is_connected`, `diameter`
- `degree`, `degree_sequence`, `density`, `isolated_nodes`, `is_complete`

### Step 22: Centrality
- `degree_centrality` — normalized to [0, 1]
- `closeness_centrality` — (n-1) / sum(distances)
- `betweenness_centrality` — Brandes algorithm, normalized

### Step 23: Minimum Spanning Tree
- `minimum_spanning_tree` — Kruskal's with union-find

## Phase 9: IFC Content / Aperture ✅

### Step 24: Content System
- `add_content(host, content, context)` — place entity inside another
- `contents(host)` — list contents with parametric positions
- `context_of(content)` — find containing host

### Step 25: Aperture System
- `add_aperture(host_face, topology)` — opening in a face
- `apertures(face)` — list apertures on a face
- `cell_apertures(cell)` — all apertures across all cell faces

---

## Test Strategy

Every phase follows test-driven development:
1. Write failing test for the next feature
2. Implement minimum code to pass
3. Refactor while keeping tests green
4. Each module has `#[cfg(test)] mod tests`

## IFC Relationship Mapping

| IFC Concept | Topology Concept |
|-------------|-----------------|
| `IfcSpace` | Cell |
| `IfcWall` / `IfcSlab` | Shared Face between Cells |
| `IfcRelSpaceBoundary` | Face-to-Cell adjacency |
| `IfcRelContainedInSpatialStructure` | Content system |
| `IfcRelVoidsElement` | Aperture (opening) |
| `IfcRelFillsElement` | Aperture (door/window filling) |
| `IfcBuilding` | CellComplex |
| Room adjacency | Dual graph edge |
| Shortest path between rooms | Dijkstra on dual graph |
| Most connected room | Betweenness centrality |
