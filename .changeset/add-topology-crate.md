---
"@ifc-lite/wasm": minor
---

Add `ifc-lite-topology` Rust crate — a clean-room non-manifold topology (NMT) engine for IFC spatial reasoning.

**14 modules, 109 tests:**

- **Core:** Arena-based NMT data structure with SlotMap keys and bidirectional adjacency indices. Vertices, edges, wires, faces, shells, cells, and cell complexes with full non-manifold support (shared walls between rooms).
- **Builders:** Tolerance-based face sewing (`sew_faces`), box constructors, and `add_cell_complex_by_cells` with automatic face deduplication for NMT shared boundaries.
- **Traversal:** Downward (cell → faces → edges → vertices) and upward (vertex → edges → faces → cells) navigation, adjacency queries, shared face detection.
- **Geometry:** Newell normals, area, volume (signed tetrahedra), centroids, ray-casting containment, earcutr triangulation.
- **Graph:** Dual graph from cell complexes (cells as nodes, shared faces as edges). Dijkstra, BFS, connected components, degree/closeness/betweenness centrality, Kruskal MST.
- **IFC integration:** Content/Context/Aperture system mapping to `IfcRelContainedInSpatialStructure`, `IfcRelVoidsElement`, and `IfcRelFillsElement`.
- **Serialization:** Full JSON round-trip with dictionary metadata.

This crate is not yet wired into the WASM bindings; this changeset tracks the Rust-side addition.
