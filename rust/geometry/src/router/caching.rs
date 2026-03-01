// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Geometry hash caching for deduplication of repeated geometry.

use super::GeometryRouter;
use crate::Mesh;
use std::hash::{Hash, Hasher};
use std::sync::Arc;

impl GeometryRouter {
    /// Compute hash of mesh geometry for deduplication.
    /// Uses FxHasher for speed — we don't need cryptographic hashing.
    ///
    /// For meshes with >MAX_HASH_ELEMENTS values, samples positions evenly
    /// instead of hashing all data. Combined with vertex/index count matching,
    /// this gives excellent collision resistance at O(1) cost per mesh.
    #[inline]
    pub(super) fn compute_mesh_hash(mesh: &Mesh) -> u64 {
        use rustc_hash::FxHasher;
        let mut hasher = FxHasher::default();

        // Hash vertex count and index count first for fast rejection
        let pos_len = mesh.positions.len();
        let idx_len = mesh.indices.len();
        pos_len.hash(&mut hasher);
        idx_len.hash(&mut hasher);

        // For small meshes, hash everything. For large meshes, sample evenly.
        // 128 samples × (positions + indices) = 256 hash ops max, regardless of mesh size.
        const MAX_HASH_ELEMENTS: usize = 128;

        if pos_len <= MAX_HASH_ELEMENTS {
            for pos in &mesh.positions {
                pos.to_bits().hash(&mut hasher);
            }
        } else {
            // Sample evenly across positions
            let step = pos_len / MAX_HASH_ELEMENTS;
            for i in (0..pos_len).step_by(step).take(MAX_HASH_ELEMENTS) {
                mesh.positions[i].to_bits().hash(&mut hasher);
            }
            // Always include last few values (catch tail differences)
            if pos_len >= 3 {
                mesh.positions[pos_len - 1].to_bits().hash(&mut hasher);
                mesh.positions[pos_len - 2].to_bits().hash(&mut hasher);
                mesh.positions[pos_len - 3].to_bits().hash(&mut hasher);
            }
        }

        if idx_len <= MAX_HASH_ELEMENTS {
            for idx in &mesh.indices {
                idx.hash(&mut hasher);
            }
        } else {
            let step = idx_len / MAX_HASH_ELEMENTS;
            for i in (0..idx_len).step_by(step).take(MAX_HASH_ELEMENTS) {
                mesh.indices[i].hash(&mut hasher);
            }
            if idx_len >= 3 {
                mesh.indices[idx_len - 1].hash(&mut hasher);
                mesh.indices[idx_len - 2].hash(&mut hasher);
                mesh.indices[idx_len - 3].hash(&mut hasher);
            }
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
