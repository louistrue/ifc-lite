<!-- This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at https://mozilla.org/MPL/2.0/. -->

# Implementation Plan: `ifc-lite-topology` Rust Crate

## Approach: Clean-Room, Test-Driven Development

All code is original work under MPL-2.0. No code is copied from TopologicPy
(AGPL v3) or TopologicCore (AGPL v3). Implementation is based on published
computational topology algorithms and the documented API contract.

## Phase 1: Core NMT Data Structure + Construction

### Step 1: Arena + Type Hierarchy
- `TopologyArena` with `SlotMap` storage for each topology type
- Key types: `VertexKey`, `EdgeKey`, `WireKey`, `FaceKey`, `ShellKey`, `CellKey`, `CellComplexKey`
- `TopologyKey` enum wrapping all key types
- `TopologyType` enum for runtime type discrimination

### Step 2: Construction Primitives
- `Vertex::new(arena, x, y, z)`
- `Edge::new(arena, start_vertex, end_vertex)`
- `Wire::new(arena, edges)` — ordered edge chain, validates connectivity
- `Face::new(arena, outer_wire)` and `Face::with_holes(arena, outer, inner_wires)`
- `Shell::new(arena, faces)` — validates face adjacency via shared edges
- `Cell::new(arena, shell)` — validates shell is closed
- `CellComplex::new(arena, cells)` — identifies shared faces between cells

### Step 3: NMT Adjacency Index
- Bidirectional maps: `vertex↔edges`, `edge↔faces`, `face↔cells`
- Non-manifold: a face can belong to 2+ cells (shared wall)
- An edge can belong to 2+ faces (shared boundary)

## Phase 2: Traversal

### Step 4: Downward Traversal
- `.vertices()`, `.edges()`, `.wires()`, `.faces()`, `.shells()`, `.cells()`
- Each topology type returns its sub-topologies (e.g., Face → edges, vertices)

### Step 5: Upward Traversal (Adjacency Queries)
- `.adjacent_edges(vertex)`, `.adjacent_faces(edge)`, `.adjacent_cells(face)`
- `.super_topologies(key)` — what contains this?

### Step 6: Boundary Queries
- `.external_boundary()` — outer shell of cell, outer wire of face
- `.internal_boundaries()` — holes in face, voids in cell
- `.is_closed()` — shell/wire closure check

## Phase 3: Geometric Queries

### Step 7: Basic Metrics
- `edge_length(arena, edge_key)` — Euclidean distance
- `face_area(arena, face_key)` — shoelace / triangle fan
- `face_normal(arena, face_key)` — Newell's method
- `cell_volume(arena, cell_key)` — signed tetrahedra method

### Step 8: Spatial Queries
- `center_of_mass(arena, key)` — weighted centroid
- `cell_contains(arena, cell_key, point)` — ray casting
- `face_contains(arena, face_key, point)` — point-in-polygon

### Step 9: Triangulation
- `triangulate_face(arena, face_key)` — earcutr on projected 2D polygon

## Phase 4: Transforms & Metadata

### Step 10: Affine Transforms
- `translate(arena, key, dx, dy, dz)`
- `rotate(arena, key, origin, axis, angle)`
- `scale(arena, key, origin, sx, sy, sz)`

### Step 11: Dictionary System
- `set_dictionary(arena, key, dict)` / `get_dictionary(arena, key)`
- Typed values: Int, Double, String, List
- Attach metadata to any topology entity

## Phase 5: Serialization

### Step 12: JSON Serialization
- `to_json(arena)` / `from_json(json)` — full arena round-trip
- Portable format for WASM ↔ server exchange

## Test Strategy

Every step gets tests FIRST (red-green-refactor):
1. Write failing test for the next feature
2. Implement minimum code to pass
3. Refactor while keeping tests green
4. Each module has `#[cfg(test)] mod tests`
