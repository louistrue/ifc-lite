// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Spatial index for tolerance-based vertex lookup and merging.
//!
//! Uses a grid-based spatial hash for O(1) average-case nearest-vertex queries.
//! This is the foundation for face sewing, where vertices within a tolerance
//! are identified as the same point.

use rustc_hash::FxHashMap;

use crate::arena::TopologyArena;
use crate::keys::VertexKey;

/// A spatial hash grid for fast tolerance-based vertex lookup.
///
/// The grid divides 3D space into cubic cells of side `cell_size`. Vertex
/// lookups check the 27 neighboring cells (3x3x3 neighborhood) for candidates
/// within tolerance.
#[derive(Debug)]
pub struct SpatialIndex {
    cell_size: f64,
    grid: FxHashMap<(i64, i64, i64), Vec<VertexKey>>,
}

impl SpatialIndex {
    /// Creates a new spatial index with the given cell size.
    ///
    /// `cell_size` should be >= the tolerance used for queries.
    pub fn new(cell_size: f64) -> Self {
        Self {
            cell_size,
            grid: FxHashMap::default(),
        }
    }

    /// Builds a spatial index from all vertices in an arena.
    pub fn from_arena(arena: &TopologyArena, cell_size: f64) -> Self {
        let mut index = Self::new(cell_size);
        for (key, data) in arena.vertices.iter() {
            index.insert(key, data.x, data.y, data.z);
        }
        index
    }

    /// Inserts a vertex key at the given coordinates.
    pub fn insert(&mut self, key: VertexKey, x: f64, y: f64, z: f64) {
        let cell = self.cell_coords(x, y, z);
        self.grid.entry(cell).or_default().push(key);
    }

    /// Finds a vertex within `tolerance` of `(x, y, z)`.
    ///
    /// Returns the first match found. For consistent results, the tolerance
    /// should be <= `cell_size`.
    pub fn find_near(
        &self,
        arena: &TopologyArena,
        x: f64,
        y: f64,
        z: f64,
        tolerance: f64,
    ) -> Option<VertexKey> {
        let (cx, cy, cz) = self.cell_coords(x, y, z);
        let tol_sq = tolerance * tolerance;

        // Search 3x3x3 neighborhood
        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    if let Some(keys) = self.grid.get(&(cx + dx, cy + dy, cz + dz)) {
                        for &vk in keys {
                            if let Some(v) = arena.vertex(vk) {
                                let dist_sq = (v.x - x).powi(2)
                                    + (v.y - y).powi(2)
                                    + (v.z - z).powi(2);
                                if dist_sq <= tol_sq {
                                    return Some(vk);
                                }
                            }
                        }
                    }
                }
            }
        }

        None
    }

    /// Finds all vertices within `tolerance` of `(x, y, z)`.
    pub fn find_all_near(
        &self,
        arena: &TopologyArena,
        x: f64,
        y: f64,
        z: f64,
        tolerance: f64,
    ) -> Vec<VertexKey> {
        let (cx, cy, cz) = self.cell_coords(x, y, z);
        let tol_sq = tolerance * tolerance;
        let mut result = Vec::new();

        for dx in -1..=1 {
            for dy in -1..=1 {
                for dz in -1..=1 {
                    if let Some(keys) = self.grid.get(&(cx + dx, cy + dy, cz + dz)) {
                        for &vk in keys {
                            if let Some(v) = arena.vertex(vk) {
                                let dist_sq = (v.x - x).powi(2)
                                    + (v.y - y).powi(2)
                                    + (v.z - z).powi(2);
                                if dist_sq <= tol_sq {
                                    result.push(vk);
                                }
                            }
                        }
                    }
                }
            }
        }

        result
    }

    fn cell_coords(&self, x: f64, y: f64, z: f64) -> (i64, i64, i64) {
        (
            (x / self.cell_size).floor() as i64,
            (y / self.cell_size).floor() as i64,
            (z / self.cell_size).floor() as i64,
        )
    }
}

impl TopologyArena {
    /// Returns an existing vertex within `tolerance` of `(x, y, z)`, or
    /// creates a new one. This is the fundamental "merge-or-create" operation
    /// used during face sewing.
    pub fn find_or_add_vertex(
        &mut self,
        index: &mut SpatialIndex,
        x: f64,
        y: f64,
        z: f64,
        tolerance: f64,
    ) -> VertexKey {
        if let Some(existing) = index.find_near(self, x, y, z, tolerance) {
            return existing;
        }

        let key = self.add_vertex(x, y, z);
        index.insert(key, x, y, z);
        key
    }

    /// Merges vertices within `tolerance` of each other, updating all edge
    /// references to point to the surviving vertex.
    ///
    /// Returns the number of vertices merged.
    pub fn merge_coincident_vertices(&mut self, tolerance: f64) -> usize {
        let index = SpatialIndex::from_arena(self, tolerance.max(1e-10));
        let tol_sq = tolerance * tolerance;
        let mut merged_count = 0;

        // Build a merge map: for each vertex, find its canonical representative
        let mut merge_map: FxHashMap<VertexKey, VertexKey> = FxHashMap::default();
        let all_keys: Vec<VertexKey> = self.vertices.keys().collect();

        for &vk in &all_keys {
            if merge_map.contains_key(&vk) {
                continue;
            }

            let v = match self.vertex(vk) {
                Some(v) => (v.x, v.y, v.z),
                None => continue,
            };

            let near = index.find_all_near(self, v.0, v.1, v.2, tolerance);
            for &other in &near {
                if other != vk && !merge_map.contains_key(&other) {
                    if let Some(ov) = self.vertex(other) {
                        let dist_sq =
                            (ov.x - v.0).powi(2) + (ov.y - v.1).powi(2) + (ov.z - v.2).powi(2);
                        if dist_sq <= tol_sq {
                            merge_map.insert(other, vk);
                            merged_count += 1;
                        }
                    }
                }
            }
        }

        // Rewrite edge references
        let edge_keys: Vec<_> = self.edges.keys().collect();
        for ek in edge_keys {
            if let Some(edge) = self.edges.get_mut(ek) {
                if let Some(&canonical) = merge_map.get(&edge.start) {
                    edge.start = canonical;
                }
                if let Some(&canonical) = merge_map.get(&edge.end) {
                    edge.end = canonical;
                }
            }
        }

        // Remove merged vertices
        for (&old, _) in &merge_map {
            self.vertices.remove(old);
        }

        // Rebuild vertex-to-edge adjacency
        self.vertex_to_edges.clear();
        for (ek, edge) in &self.edges {
            self.vertex_to_edges
                .entry(edge.start)
                .or_default()
                .insert(ek);
            self.vertex_to_edges
                .entry(edge.end)
                .or_default()
                .insert(ek);
        }

        merged_count
    }

    /// Finds the nearest vertex to a point within tolerance.
    pub fn find_vertex_near(
        &self,
        x: f64,
        y: f64,
        z: f64,
        tolerance: f64,
    ) -> Option<VertexKey> {
        let tol_sq = tolerance * tolerance;
        let mut best: Option<(VertexKey, f64)> = None;

        for (key, v) in &self.vertices {
            let dist_sq = (v.x - x).powi(2) + (v.y - y).powi(2) + (v.z - z).powi(2);
            if dist_sq <= tol_sq {
                if best.is_none() || dist_sq < best.unwrap().1 {
                    best = Some((key, dist_sq));
                }
            }
        }

        best.map(|(k, _)| k)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spatial_index_find_near() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let _v1 = arena.add_vertex(10.0, 10.0, 10.0);

        let index = SpatialIndex::from_arena(&arena, 0.01);

        // Exact match
        assert_eq!(index.find_near(&arena, 0.0, 0.0, 0.0, 0.001), Some(v0));

        // Within tolerance
        assert_eq!(
            index.find_near(&arena, 0.001, 0.0, 0.0, 0.01),
            Some(v0)
        );

        // Outside tolerance
        assert_eq!(index.find_near(&arena, 1.0, 0.0, 0.0, 0.01), None);
    }

    #[test]
    fn find_or_add_reuses_vertex() {
        let mut arena = TopologyArena::new();
        let mut index = SpatialIndex::new(0.01);

        let v0 = arena.find_or_add_vertex(&mut index, 0.0, 0.0, 0.0, 0.001);
        let v1 = arena.find_or_add_vertex(&mut index, 0.0001, 0.0, 0.0, 0.001);
        let v2 = arena.find_or_add_vertex(&mut index, 5.0, 5.0, 5.0, 0.001);

        // v1 should reuse v0 (within tolerance)
        assert_eq!(v0, v1);
        assert_ne!(v0, v2);
        assert_eq!(arena.vertex_count(), 2);
    }

    #[test]
    fn merge_coincident_vertices() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(0.0001, 0.0, 0.0); // near v0
        let v2 = arena.add_vertex(10.0, 10.0, 10.0); // far away
        let v3 = arena.add_vertex(10.0001, 10.0, 10.0); // near v2

        // Create edges referencing all vertices
        arena.add_edge(v0, v2).unwrap();
        arena.add_edge(v1, v3).unwrap();

        let merged = arena.merge_coincident_vertices(0.001);
        assert_eq!(merged, 2); // v1→v0, v3→v2
        assert_eq!(arena.vertex_count(), 2);
    }

    #[test]
    fn find_vertex_near_brute_force() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(5.0, 5.0, 5.0);
        arena.add_vertex(100.0, 100.0, 100.0);

        let found = arena.find_vertex_near(5.001, 5.0, 5.0, 0.01);
        assert_eq!(found, Some(v0));

        let not_found = arena.find_vertex_near(50.0, 50.0, 50.0, 0.01);
        assert!(not_found.is_none());
    }

    #[test]
    fn find_all_near() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(0.001, 0.0, 0.0);
        arena.add_vertex(10.0, 10.0, 10.0); // far away

        let index = SpatialIndex::from_arena(&arena, 0.01);
        let near = index.find_all_near(&arena, 0.0, 0.0, 0.0, 0.01);

        assert_eq!(near.len(), 2);
        assert!(near.contains(&v0));
        assert!(near.contains(&v1));
    }
}
