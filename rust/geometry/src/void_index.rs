// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Void Index Module
//!
//! Builds and manages the mapping between host elements (walls, slabs, etc.)
//! and their associated voids (openings, penetrations).
//!
//! In IFC, voids are related to their host elements via `IfcRelVoidsElement`:
//! - RelatingBuildingElement: The host (wall, slab, beam, etc.)
//! - RelatedOpeningElement: The opening (IfcOpeningElement)

use ifc_lite_core::{EntityDecoder, EntityScanner};
use rustc_hash::FxHashMap;

/// Index mapping host elements to their voids
///
/// Provides efficient lookup of void entity IDs for any host element,
/// enabling void-aware geometry processing.
#[derive(Debug, Clone)]
pub struct VoidIndex {
    /// Map from host entity ID to list of void entity IDs
    host_to_voids: FxHashMap<u32, Vec<u32>>,
    /// Map from void entity ID to host entity ID (reverse lookup)
    void_to_host: FxHashMap<u32, u32>,
    /// Total number of void relationships
    relationship_count: usize,
}

impl VoidIndex {
    /// Create an empty void index
    pub fn new() -> Self {
        Self {
            host_to_voids: FxHashMap::default(),
            void_to_host: FxHashMap::default(),
            relationship_count: 0,
        }
    }

    /// Build void index from IFC content
    ///
    /// Scans the content for `IfcRelVoidsElement` entities and builds
    /// the host-to-void mapping.
    ///
    /// # Arguments
    /// * `content` - The raw IFC file content
    /// * `decoder` - Entity decoder for parsing
    ///
    /// # Returns
    /// A populated VoidIndex
    pub fn from_content(content: &str, decoder: &mut EntityDecoder) -> Self {
        let mut index = Self::new();
        let mut scanner = EntityScanner::new(content);

        while let Some((_id, type_name, start, end)) = scanner.next_entity() {
            // Look for IfcRelVoidsElement relationships
            if type_name == "IFCRELVOIDSELEMENT" {
                if let Ok(entity) = decoder.decode_at(start, end) {
                    // IfcRelVoidsElement structure:
                    // #id = IFCRELVOIDSELEMENT(GlobalId, OwnerHistory, Name, Description,
                    //                          RelatingBuildingElement, RelatedOpeningElement);
                    // Indices: 0=GlobalId, 1=OwnerHistory, 2=Name, 3=Description,
                    //          4=RelatingBuildingElement, 5=RelatedOpeningElement

                    if let (Some(host_id), Some(void_id)) = (entity.get_ref(4), entity.get_ref(5)) {
                        index.add_relationship(host_id, void_id);
                    }
                }
            }
        }

        index
    }

    /// Add a void relationship
    pub fn add_relationship(&mut self, host_id: u32, void_id: u32) {
        self.host_to_voids.entry(host_id).or_default().push(void_id);
        self.void_to_host.insert(void_id, host_id);
        self.relationship_count += 1;
    }

    /// Get void IDs for a host element
    ///
    /// # Arguments
    /// * `host_id` - The entity ID of the host element
    ///
    /// # Returns
    /// Slice of void entity IDs, or empty slice if no voids
    pub fn get_voids(&self, host_id: u32) -> &[u32] {
        self.host_to_voids
            .get(&host_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Get the host ID for a void element
    ///
    /// # Arguments
    /// * `void_id` - The entity ID of the void/opening
    ///
    /// # Returns
    /// The host entity ID, if found
    pub fn get_host(&self, void_id: u32) -> Option<u32> {
        self.void_to_host.get(&void_id).copied()
    }

    /// Check if an element has any voids
    pub fn has_voids(&self, host_id: u32) -> bool {
        self.host_to_voids
            .get(&host_id)
            .map(|v| !v.is_empty())
            .unwrap_or(false)
    }

    /// Get number of voids for a host element
    pub fn void_count(&self, host_id: u32) -> usize {
        self.host_to_voids
            .get(&host_id)
            .map(|v| v.len())
            .unwrap_or(0)
    }

    /// Get total number of host elements with voids
    pub fn host_count(&self) -> usize {
        self.host_to_voids.len()
    }

    /// Get total number of void relationships
    pub fn total_relationships(&self) -> usize {
        self.relationship_count
    }

    /// Iterate over all host elements and their voids
    pub fn iter(&self) -> impl Iterator<Item = (u32, &[u32])> {
        self.host_to_voids.iter().map(|(k, v)| (*k, v.as_slice()))
    }

    /// Get all host IDs that have voids
    pub fn hosts_with_voids(&self) -> Vec<u32> {
        self.host_to_voids.keys().copied().collect()
    }

    /// Check if an entity is a void/opening
    pub fn is_void(&self, entity_id: u32) -> bool {
        self.void_to_host.contains_key(&entity_id)
    }

    /// Check if an entity is a host with voids
    pub fn is_host_with_voids(&self, entity_id: u32) -> bool {
        self.host_to_voids.contains_key(&entity_id)
    }
}

impl Default for VoidIndex {
    fn default() -> Self {
        Self::new()
    }
}

/// Statistics about void distribution in a model
#[derive(Debug, Clone)]
pub struct VoidStatistics {
    /// Total number of hosts with voids
    pub hosts_with_voids: usize,
    /// Total number of void relationships
    pub total_voids: usize,
    /// Maximum voids on a single host
    pub max_voids_per_host: usize,
    /// Average voids per host (that has voids)
    pub avg_voids_per_host: f64,
    /// Number of hosts with many voids (>10)
    pub hosts_with_many_voids: usize,
}

impl VoidStatistics {
    /// Compute statistics from a void index
    pub fn from_index(index: &VoidIndex) -> Self {
        let hosts_with_voids = index.host_count();
        let total_voids = index.total_relationships();

        let max_voids_per_host = index
            .host_to_voids
            .values()
            .map(|v| v.len())
            .max()
            .unwrap_or(0);

        let avg_voids_per_host = if hosts_with_voids > 0 {
            total_voids as f64 / hosts_with_voids as f64
        } else {
            0.0
        };

        let hosts_with_many_voids = index.host_to_voids.values().filter(|v| v.len() > 10).count();

        Self {
            hosts_with_voids,
            total_voids,
            max_voids_per_host,
            avg_voids_per_host,
            hosts_with_many_voids,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_void_index_basic() {
        let mut index = VoidIndex::new();

        // Add some relationships
        index.add_relationship(100, 200);
        index.add_relationship(100, 201);
        index.add_relationship(101, 202);

        // Test lookups
        assert_eq!(index.get_voids(100), &[200, 201]);
        assert_eq!(index.get_voids(101), &[202]);
        assert!(index.get_voids(999).is_empty());

        // Test reverse lookup
        assert_eq!(index.get_host(200), Some(100));
        assert_eq!(index.get_host(202), Some(101));
        assert_eq!(index.get_host(999), None);

        // Test counts
        assert_eq!(index.void_count(100), 2);
        assert_eq!(index.void_count(101), 1);
        assert_eq!(index.host_count(), 2);
        assert_eq!(index.total_relationships(), 3);
    }

    #[test]
    fn test_void_index_has_voids() {
        let mut index = VoidIndex::new();
        index.add_relationship(100, 200);

        assert!(index.has_voids(100));
        assert!(!index.has_voids(999));
    }

    #[test]
    fn test_void_index_is_void() {
        let mut index = VoidIndex::new();
        index.add_relationship(100, 200);

        assert!(index.is_void(200));
        assert!(!index.is_void(100));
        assert!(!index.is_void(999));
    }

    #[test]
    fn test_void_index_hosts_with_voids() {
        let mut index = VoidIndex::new();
        index.add_relationship(100, 200);
        index.add_relationship(101, 201);
        index.add_relationship(102, 202);

        let hosts = index.hosts_with_voids();
        assert_eq!(hosts.len(), 3);
        assert!(hosts.contains(&100));
        assert!(hosts.contains(&101));
        assert!(hosts.contains(&102));
    }

    #[test]
    fn test_void_statistics() {
        let mut index = VoidIndex::new();

        // Host 100 has 3 voids
        index.add_relationship(100, 200);
        index.add_relationship(100, 201);
        index.add_relationship(100, 202);

        // Host 101 has 1 void
        index.add_relationship(101, 203);

        let stats = VoidStatistics::from_index(&index);

        assert_eq!(stats.hosts_with_voids, 2);
        assert_eq!(stats.total_voids, 4);
        assert_eq!(stats.max_voids_per_host, 3);
        assert!((stats.avg_voids_per_host - 2.0).abs() < 0.01);
        assert_eq!(stats.hosts_with_many_voids, 0);
    }

    #[test]
    fn test_void_statistics_many_voids() {
        let mut index = VoidIndex::new();

        // Host 100 has 15 voids (> 10 threshold)
        for i in 0..15 {
            index.add_relationship(100, 200 + i);
        }

        let stats = VoidStatistics::from_index(&index);
        assert_eq!(stats.hosts_with_many_voids, 1);
    }
}
