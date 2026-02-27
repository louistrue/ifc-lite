// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Topology query methods: type checks, sub-topology selection, shared
//! topologies, non-manifold detection, deep copy, distance, and analysis.
//!
//! These correspond to the query operations in computational topology that
//! are essential for IFC spatial reasoning — e.g., "which faces are shared
//! between these two cells?" or "find the nearest face to this point."

use nalgebra::Point3;
use rustc_hash::FxHashSet;

use crate::arena::TopologyArena;
use crate::keys::*;

impl TopologyArena {
    /// Returns the topology type of a key.
    pub fn topology_type(&self, key: TopologyKey) -> TopologyType {
        key.topology_type()
    }

    /// Returns the type name as a string (e.g., "Vertex", "Face", "Cell").
    pub fn type_as_string(&self, key: TopologyKey) -> &'static str {
        key.topology_type().as_str()
    }

    /// Checks if two topology keys reference the same entity.
    pub fn is_same(&self, a: TopologyKey, b: TopologyKey) -> bool {
        a == b
    }

    /// Finds the nearest sub-topology entity of the given type to a selector point.
    ///
    /// For example, find the nearest Face in a Shell to a given point.
    /// This is the equivalent of TopologicPy's `SelectSubtopology`.
    pub fn select_sub_topology(
        &self,
        host: TopologyKey,
        selector: &Point3<f64>,
        target_type: TopologyType,
    ) -> Option<TopologyKey> {
        match target_type {
            TopologyType::Vertex => {
                let verts = self.collect_vertices_for_key(host)?;
                self.nearest_vertex(&verts, selector)
                    .map(TopologyKey::Vertex)
            }
            TopologyType::Edge => {
                let edges = self.collect_edges_for_key(host)?;
                self.nearest_edge(&edges, selector)
                    .map(TopologyKey::Edge)
            }
            TopologyType::Face => {
                let faces = self.collect_faces_for_key(host)?;
                self.nearest_face(&faces, selector)
                    .map(TopologyKey::Face)
            }
            TopologyType::Cell => {
                let cells = self.collect_cells_for_key(host)?;
                self.nearest_cell(&cells, selector)
                    .map(TopologyKey::Cell)
            }
            _ => None, // Wire, Shell, CellComplex selection not commonly needed
        }
    }

    /// Returns shared sub-topologies between two topology entities.
    ///
    /// For example, shared vertices between two edges, or shared faces between
    /// two cells. This is the NMT query that answers "what connects these?"
    pub fn shared_topologies(
        &self,
        a: TopologyKey,
        b: TopologyKey,
        target_type: TopologyType,
    ) -> Vec<TopologyKey> {
        match target_type {
            TopologyType::Vertex => {
                let va = self.collect_vertices_for_key(a);
                let vb = self.collect_vertices_for_key(b);
                match (va, vb) {
                    (Some(a_set), Some(b_set)) => a_set
                        .intersection(&b_set)
                        .map(|&k| TopologyKey::Vertex(k))
                        .collect(),
                    _ => Vec::new(),
                }
            }
            TopologyType::Edge => {
                let ea = self.collect_edges_for_key(a);
                let eb = self.collect_edges_for_key(b);
                match (ea, eb) {
                    (Some(a_set), Some(b_set)) => a_set
                        .intersection(&b_set)
                        .map(|&k| TopologyKey::Edge(k))
                        .collect(),
                    _ => Vec::new(),
                }
            }
            TopologyType::Face => {
                let fa = self.collect_faces_for_key(a);
                let fb = self.collect_faces_for_key(b);
                match (fa, fb) {
                    (Some(a_set), Some(b_set)) => a_set
                        .intersection(&b_set)
                        .map(|&k| TopologyKey::Face(k))
                        .collect(),
                    _ => Vec::new(),
                }
            }
            _ => Vec::new(),
        }
    }

    /// Returns non-manifold faces in a cell complex — faces shared by 3+ cells.
    ///
    /// In standard topology, each face borders at most 2 cells. NMT allows
    /// more. This method finds those exceptional faces (e.g., a wall at a
    /// T-junction of three rooms).
    pub fn non_manifold_faces(&self, complex: CellComplexKey) -> Vec<FaceKey> {
        let cc = match self.cell_complexes.get(complex) {
            Some(cc) => cc,
            None => return Vec::new(),
        };

        // Count how many cells each face belongs to
        let mut face_cell_count: rustc_hash::FxHashMap<FaceKey, usize> =
            rustc_hash::FxHashMap::default();

        for &ck in &cc.cells {
            if let Some(faces) = self.cell_faces(ck) {
                for fk in faces {
                    *face_cell_count.entry(fk).or_insert(0) += 1;
                }
            }
        }

        // Non-manifold = shared by 3+ cells
        face_cell_count
            .into_iter()
            .filter(|&(_, count)| count >= 3)
            .map(|(fk, _)| fk)
            .collect()
    }

    /// Returns internal faces of a cell complex — faces shared by exactly 2 cells.
    ///
    /// These are the "walls between rooms" in an IFC building model.
    pub fn internal_faces(&self, complex: CellComplexKey) -> Vec<FaceKey> {
        let cc = match self.cell_complexes.get(complex) {
            Some(cc) => cc,
            None => return Vec::new(),
        };

        let mut face_cell_count: rustc_hash::FxHashMap<FaceKey, usize> =
            rustc_hash::FxHashMap::default();

        for &ck in &cc.cells {
            if let Some(faces) = self.cell_faces(ck) {
                for fk in faces {
                    *face_cell_count.entry(fk).or_insert(0) += 1;
                }
            }
        }

        face_cell_count
            .into_iter()
            .filter(|&(_, count)| count == 2)
            .map(|(fk, _)| fk)
            .collect()
    }

    /// Returns external faces of a cell complex — faces belonging to only 1 cell.
    ///
    /// These are the exterior walls/roof/floor of a building.
    pub fn external_faces(&self, complex: CellComplexKey) -> Vec<FaceKey> {
        let cc = match self.cell_complexes.get(complex) {
            Some(cc) => cc,
            None => return Vec::new(),
        };

        let mut face_cell_count: rustc_hash::FxHashMap<FaceKey, usize> =
            rustc_hash::FxHashMap::default();

        for &ck in &cc.cells {
            if let Some(faces) = self.cell_faces(ck) {
                for fk in faces {
                    *face_cell_count.entry(fk).or_insert(0) += 1;
                }
            }
        }

        face_cell_count
            .into_iter()
            .filter(|&(_, count)| count == 1)
            .map(|(fk, _)| fk)
            .collect()
    }

    /// Creates a deep copy of a topology subgraph in the same arena.
    ///
    /// All vertices, edges, wires, and faces are duplicated with new keys.
    /// Returns the key of the copied top-level entity.
    pub fn deep_copy_face(&mut self, face: FaceKey) -> Option<FaceKey> {
        let face_data = self.faces.get(face)?.clone();
        let outer_wire = self.wires.get(face_data.outer_wire)?.clone();

        // Copy vertices and build old→new mapping
        let mut vertex_map: rustc_hash::FxHashMap<VertexKey, VertexKey> =
            rustc_hash::FxHashMap::default();

        let copy_vertex = |arena: &mut TopologyArena,
                           map: &mut rustc_hash::FxHashMap<VertexKey, VertexKey>,
                           vk: VertexKey|
         -> Option<VertexKey> {
            if let Some(&new_vk) = map.get(&vk) {
                return Some(new_vk);
            }
            let v = arena.vertex(vk)?;
            let new_vk = arena.add_vertex(v.x, v.y, v.z);
            map.insert(vk, new_vk);
            Some(new_vk)
        };

        // Copy edges of outer wire
        let mut new_edges = Vec::with_capacity(outer_wire.edges.len());
        for &ek in &outer_wire.edges {
            let edge = self.edges.get(ek)?;
            let (es, ee) = (edge.start, edge.end);
            let new_start = copy_vertex(self, &mut vertex_map, es)?;
            let new_end = copy_vertex(self, &mut vertex_map, ee)?;
            let new_edge = self.add_edge(new_start, new_end).ok()?;
            new_edges.push(new_edge);
        }

        let new_outer_wire = self.add_wire(&new_edges).ok()?;

        // Copy inner wires
        let mut new_inner_wires = Vec::with_capacity(face_data.inner_wires.len());
        for &iwk in &face_data.inner_wires {
            let inner_wire = self.wires.get(iwk)?.clone();
            let mut inner_edges = Vec::with_capacity(inner_wire.edges.len());
            for &ek in &inner_wire.edges {
                let edge = self.edges.get(ek)?;
                let (es, ee) = (edge.start, edge.end);
                let new_start = copy_vertex(self, &mut vertex_map, es)?;
                let new_end = copy_vertex(self, &mut vertex_map, ee)?;
                let new_edge = self.add_edge(new_start, new_end).ok()?;
                inner_edges.push(new_edge);
            }
            let new_iw = self.add_wire(&inner_edges).ok()?;
            new_inner_wires.push(new_iw);
        }

        if new_inner_wires.is_empty() {
            self.add_face(new_outer_wire).ok()
        } else {
            self.add_face_with_holes(new_outer_wire, &new_inner_wires).ok()
        }
    }

    /// Computes the minimum distance between a point and a face (approximate).
    ///
    /// Uses the face centroid as an approximation. For exact distance, the
    /// point would need to be projected onto the face plane and tested against
    /// the boundary — but centroid distance is sufficient for IFC spatial
    /// reasoning (room assignment, nearest-space queries).
    pub fn distance_point_to_face(&self, point: &Point3<f64>, face: FaceKey) -> Option<f64> {
        let centroid = self.face_centroid(face)?;
        Some((point - centroid).norm())
    }

    /// Computes the distance between two cell centroids.
    pub fn distance_cell_to_cell(&self, a: CellKey, b: CellKey) -> Option<f64> {
        let ca = self.cell_centroid(a)?;
        let cb = self.cell_centroid(b)?;
        Some((ca - cb).norm())
    }

    /// Tests if a point is inside a face (2D point-in-polygon on the face plane).
    pub fn face_contains_point(&self, face: FaceKey, point: &Point3<f64>) -> Option<bool> {
        let face_data = self.faces.get(face)?;
        let normal = self.face_normal(face)?;
        let verts = self.wire_vertices_ordered(face_data.outer_wire)?;

        if verts.len() < 3 {
            return Some(false);
        }

        // Project point onto face plane
        let p0 = self.vertex_point(verts[0])?;
        let to_point = point - p0;
        let dist_to_plane = to_point.dot(&normal).abs();

        // If point is far from the face plane, it's outside
        if dist_to_plane > 1e-6 {
            return Some(false);
        }

        // Determine projection axes
        let abs_n = nalgebra::Vector3::new(normal.x.abs(), normal.y.abs(), normal.z.abs());
        let (ax_u, ax_v) = if abs_n.z >= abs_n.x && abs_n.z >= abs_n.y {
            (0, 1)
        } else if abs_n.y >= abs_n.x {
            (0, 2)
        } else {
            (1, 2)
        };

        let test_pt = [
            [point.x, point.y, point.z][ax_u],
            [point.x, point.y, point.z][ax_v],
        ];

        // Collect 2D polygon vertices
        let mut poly_2d = Vec::with_capacity(verts.len());
        for &vk in &verts {
            let p = self.vertex_point(vk)?;
            let coords = [p.x, p.y, p.z];
            poly_2d.push([coords[ax_u], coords[ax_v]]);
        }

        // Ray casting in 2D
        Some(point_in_polygon_2d(&test_pt, &poly_2d))
    }

    // --- Internal helpers for collecting sub-topologies ---

    fn collect_vertices_for_key(&self, key: TopologyKey) -> Option<FxHashSet<VertexKey>> {
        match key {
            TopologyKey::Vertex(vk) => {
                let mut s = FxHashSet::default();
                s.insert(vk);
                Some(s)
            }
            TopologyKey::Edge(ek) => {
                let e = self.edges.get(ek)?;
                let mut s = FxHashSet::default();
                s.insert(e.start);
                s.insert(e.end);
                Some(s)
            }
            TopologyKey::Wire(wk) => self.wire_vertices(wk),
            TopologyKey::Face(fk) => self.face_vertices(fk),
            TopologyKey::Shell(sk) => self.shell_vertices(sk),
            TopologyKey::Cell(ck) => self.cell_vertices(ck),
            TopologyKey::CellComplex(cck) => self.complex_vertices(cck),
        }
    }

    fn collect_edges_for_key(&self, key: TopologyKey) -> Option<FxHashSet<EdgeKey>> {
        match key {
            TopologyKey::Edge(ek) => {
                let mut s = FxHashSet::default();
                s.insert(ek);
                Some(s)
            }
            TopologyKey::Wire(wk) => {
                let w = self.wires.get(wk)?;
                let mut s = FxHashSet::default();
                s.extend(&w.edges);
                Some(s)
            }
            TopologyKey::Face(fk) => self.face_edges(fk),
            TopologyKey::Shell(sk) => self.shell_edges(sk),
            TopologyKey::Cell(ck) => self.cell_edges(ck),
            TopologyKey::CellComplex(cck) => self.complex_edges(cck),
            _ => None,
        }
    }

    fn collect_faces_for_key(&self, key: TopologyKey) -> Option<FxHashSet<FaceKey>> {
        match key {
            TopologyKey::Face(fk) => {
                let mut s = FxHashSet::default();
                s.insert(fk);
                Some(s)
            }
            TopologyKey::Shell(sk) => {
                let sh = self.shells.get(sk)?;
                let mut s = FxHashSet::default();
                s.extend(&sh.faces);
                Some(s)
            }
            TopologyKey::Cell(ck) => self.cell_faces(ck),
            TopologyKey::CellComplex(cck) => self.complex_faces(cck),
            _ => None,
        }
    }

    fn collect_cells_for_key(&self, key: TopologyKey) -> Option<FxHashSet<CellKey>> {
        match key {
            TopologyKey::Cell(ck) => {
                let mut s = FxHashSet::default();
                s.insert(ck);
                Some(s)
            }
            TopologyKey::CellComplex(cck) => {
                let cc = self.cell_complexes.get(cck)?;
                let mut s = FxHashSet::default();
                s.extend(&cc.cells);
                Some(s)
            }
            _ => None,
        }
    }

    fn nearest_vertex(&self, verts: &FxHashSet<VertexKey>, point: &Point3<f64>) -> Option<VertexKey> {
        let mut best: Option<(VertexKey, f64)> = None;
        for &vk in verts {
            if let Some(p) = self.vertex_point(vk) {
                let dist_sq = (p - point).norm_squared();
                if best.is_none() || dist_sq < best.unwrap().1 {
                    best = Some((vk, dist_sq));
                }
            }
        }
        best.map(|(k, _)| k)
    }

    fn nearest_edge(&self, edges: &FxHashSet<EdgeKey>, point: &Point3<f64>) -> Option<EdgeKey> {
        let mut best: Option<(EdgeKey, f64)> = None;
        for &ek in edges {
            if let Some(dist) = self.distance_point_to_edge(point, ek) {
                if best.is_none() || dist < best.unwrap().1 {
                    best = Some((ek, dist));
                }
            }
        }
        best.map(|(k, _)| k)
    }

    fn nearest_face(&self, faces: &FxHashSet<FaceKey>, point: &Point3<f64>) -> Option<FaceKey> {
        let mut best: Option<(FaceKey, f64)> = None;
        for &fk in faces {
            if let Some(centroid) = self.face_centroid(fk) {
                let dist = (centroid - point).norm();
                if best.is_none() || dist < best.unwrap().1 {
                    best = Some((fk, dist));
                }
            }
        }
        best.map(|(k, _)| k)
    }

    fn nearest_cell(&self, cells: &FxHashSet<CellKey>, point: &Point3<f64>) -> Option<CellKey> {
        let mut best: Option<(CellKey, f64)> = None;
        for &ck in cells {
            if let Some(centroid) = self.cell_centroid(ck) {
                let dist = (centroid - point).norm();
                if best.is_none() || dist < best.unwrap().1 {
                    best = Some((ck, dist));
                }
            }
        }
        best.map(|(k, _)| k)
    }

    /// Distance from a point to an edge (closest point on line segment).
    fn distance_point_to_edge(&self, point: &Point3<f64>, edge: EdgeKey) -> Option<f64> {
        let e = self.edges.get(edge)?;
        let a = self.vertex_point(e.start)?;
        let b = self.vertex_point(e.end)?;

        let ab = b - a;
        let ap = point - a;
        let t = ap.dot(&ab) / ab.norm_squared();
        let t_clamped = t.clamp(0.0, 1.0);
        let closest = a + ab * t_clamped;
        Some((point - closest).norm())
    }
}

/// 2D ray-casting point-in-polygon test.
fn point_in_polygon_2d(point: &[f64; 2], polygon: &[[f64; 2]]) -> bool {
    let n = polygon.len();
    let mut inside = false;

    let mut j = n - 1;
    for i in 0..n {
        let yi = polygon[i][1];
        let yj = polygon[j][1];
        let xi = polygon[i][0];
        let xj = polygon[j][0];

        if ((yi > point[1]) != (yj > point[1]))
            && (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi)
        {
            inside = !inside;
        }
        j = i;
    }

    inside
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::make_rectangle;

    #[test]
    fn type_as_string() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);
        assert_eq!(arena.type_as_string(TopologyKey::Vertex(vk)), "Vertex");
    }

    #[test]
    fn is_same() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);

        assert!(arena.is_same(TopologyKey::Vertex(v0), TopologyKey::Vertex(v0)));
        assert!(!arena.is_same(TopologyKey::Vertex(v0), TopologyKey::Vertex(v1)));
    }

    #[test]
    fn select_nearest_vertex() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();

        let selector = Point3::new(0.9, 0.1, 0.0);
        let nearest = arena.select_sub_topology(
            TopologyKey::Face(face),
            &selector,
            TopologyType::Vertex,
        );

        assert_eq!(nearest, Some(TopologyKey::Vertex(v1)));
    }

    #[test]
    fn shared_vertices_between_edges() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(0.0, 1.0, 0.0);

        let e0 = arena.add_edge(v0, v1).unwrap();
        let e1 = arena.add_edge(v0, v2).unwrap();

        let shared = arena.shared_topologies(
            TopologyKey::Edge(e0),
            TopologyKey::Edge(e1),
            TopologyType::Vertex,
        );

        assert_eq!(shared.len(), 1);
        assert_eq!(shared[0], TopologyKey::Vertex(v0));
    }

    #[test]
    fn non_manifold_faces_empty_for_single_cell() {
        let mut arena = TopologyArena::new();
        let (cell, _, _) = arena.make_box([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]).unwrap();

        let complex = arena.add_cell_complex(&[cell]).unwrap();
        let nm = arena.non_manifold_faces(complex);
        assert!(nm.is_empty());
    }

    #[test]
    fn internal_and_external_faces() {
        let mut arena = TopologyArena::new();
        let complex = arena
            .make_adjacent_boxes(
                [0.0, 0.0, 0.0],
                [1.0, 1.0, 1.0],
                [1.0, 0.0, 0.0],
                [2.0, 1.0, 1.0],
                0.001,
            )
            .unwrap();

        let internal = arena.internal_faces(complex);
        assert_eq!(internal.len(), 1, "one shared wall between rooms");

        let external = arena.external_faces(complex);
        // 2 boxes × 6 faces - 2 internal = 10 external
        assert_eq!(external.len(), 10);
    }

    #[test]
    fn deep_copy_face_creates_independent_copy() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);

        let (original, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();
        let orig_vertex_count = arena.vertex_count();

        let copy = arena.deep_copy_face(original).unwrap();
        assert_ne!(original, copy);

        // Copy should have its own vertices
        assert_eq!(arena.vertex_count(), orig_vertex_count + 4);

        // Both should have the same area
        let orig_area = arena.face_area(original).unwrap();
        let copy_area = arena.face_area(copy).unwrap();
        assert!((orig_area - copy_area).abs() < 1e-10);
    }

    #[test]
    fn face_contains_point_inside() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(10.0, 0.0, 0.0);
        let v2 = arena.add_vertex(10.0, 10.0, 0.0);
        let v3 = arena.add_vertex(0.0, 10.0, 0.0);

        let (face, _, _) = make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();

        let inside = Point3::new(5.0, 5.0, 0.0);
        let outside = Point3::new(15.0, 5.0, 0.0);
        let above = Point3::new(5.0, 5.0, 5.0);

        assert!(arena.face_contains_point(face, &inside).unwrap());
        assert!(!arena.face_contains_point(face, &outside).unwrap());
        assert!(!arena.face_contains_point(face, &above).unwrap());
    }

    #[test]
    fn distance_point_to_edge_perpendicular() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(10.0, 0.0, 0.0);
        let edge = arena.add_edge(v0, v1).unwrap();

        let point = Point3::new(5.0, 3.0, 0.0);
        let dist = arena.distance_point_to_edge(&point, edge).unwrap();
        assert!((dist - 3.0).abs() < 1e-10);
    }

    #[test]
    fn distance_cell_to_cell_centroids() {
        let mut arena = TopologyArena::new();
        let (c1, _, _) = arena.make_box([0.0, 0.0, 0.0], [1.0, 1.0, 1.0]).unwrap();
        let (c2, _, _) = arena.make_box([3.0, 0.0, 0.0], [4.0, 1.0, 1.0]).unwrap();

        let dist = arena.distance_cell_to_cell(c1, c2).unwrap();
        // Centroids at (0.5, 0.5, 0.5) and (3.5, 0.5, 0.5), distance = 3.0
        assert!((dist - 3.0).abs() < 0.01);
    }
}
