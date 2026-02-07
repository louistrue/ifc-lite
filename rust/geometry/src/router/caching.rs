// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometry hash caching for deduplication of repeated geometry.

use super::GeometryRouter;
use crate::Mesh;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

impl GeometryRouter {
    /// Compute hash of mesh geometry for deduplication
    /// Uses FxHasher for speed - we don't need cryptographic hashing
    #[inline]
    pub(super) fn compute_mesh_hash(mesh: &Mesh) -> u64 {
        use rustc_hash::FxHasher;
        let mut hasher = FxHasher::default();

        // Hash vertex count and index count first for fast rejection
        mesh.positions.len().hash(&mut hasher);
        mesh.indices.len().hash(&mut hasher);

        // Hash position data (the main differentiator)
        // Convert f32 to bits for reliable hashing
        for pos in &mesh.positions {
            pos.to_bits().hash(&mut hasher);
        }

        // Hash indices
        for idx in &mesh.indices {
            idx.hash(&mut hasher);
        }

        hasher.finish()
    }

    /// Try to get cached mesh by hash, or cache the provided mesh
    /// Returns `Arc<Mesh>` - either from cache or newly cached
    ///
    /// Note: Uses hash-only lookup without full equality check for performance.
    /// FxHasher's 64-bit output makes collisions extremely rare (~1 in 2^64).
    #[inline]
    pub(super) fn get_or_cache_by_hash(&self, mesh: Mesh) -> Arc<Mesh> {
        let hash = Self::compute_mesh_hash(&mesh);

        // Check cache first
        {
            let cache = self.geometry_hash_cache.borrow();
            if let Some(cached) = cache.get(&hash) {
                return Arc::clone(cached);
            }
        }

        // Cache miss - store and return
        let arc_mesh = Arc::new(mesh);
        {
            let mut cache = self.geometry_hash_cache.borrow_mut();
            cache.insert(hash, Arc::clone(&arc_mesh));
        }
        arc_mesh
    }
}
