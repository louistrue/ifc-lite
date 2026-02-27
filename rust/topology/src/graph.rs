// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Topology-derived dual graph for spatial reasoning.
//!
//! Builds a graph from a `TopologyArena` where:
//! - **Nodes** = cells (rooms/spaces in IFC)
//! - **Edges** = shared faces between cells (walls/slabs)
//!
//! This dual graph is the key data structure for IFC spatial queries like
//! "which rooms are adjacent?", "what's the shortest path from room A to
//! room B?", and "which room is most central?".
//!
//! Also supports general-purpose graphs built from topology vertices and edges,
//! with standard graph algorithms (Dijkstra, connected components, centrality,
//! minimum spanning tree).

use std::collections::{BinaryHeap, VecDeque};
use std::cmp::Ordering;

use rustc_hash::FxHashMap;

use crate::arena::TopologyArena;
use crate::dictionary::Dictionary;
use crate::keys::*;

/// A node in the topology graph.
#[derive(Debug, Clone)]
pub struct GraphNode {
    /// The topology entity this node represents (usually a Cell).
    pub topology_key: TopologyKey,
    /// Optional metadata (e.g., IFC space name, function).
    pub dictionary: Dictionary,
}

/// An edge in the topology graph.
#[derive(Debug, Clone)]
pub struct GraphEdge {
    /// Source node index.
    pub source: usize,
    /// Target node index.
    pub target: usize,
    /// Weight (e.g., shared face area, distance between centroids).
    pub weight: f64,
    /// The topology entity this edge represents (usually a shared Face).
    pub topology_key: Option<TopologyKey>,
}

/// A graph built from topology for spatial reasoning.
///
/// Supports both topology-derived dual graphs (cells as nodes, shared faces
/// as edges) and general vertex-edge graphs.
#[derive(Debug)]
pub struct TopologyGraph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Adjacency list: node index → list of (neighbor index, edge index).
    adjacency: Vec<Vec<(usize, usize)>>,
    /// Map from topology key to node index for fast lookup.
    key_to_node: FxHashMap<TopologyKey, usize>,
}

impl TopologyGraph {
    /// Creates an empty graph.
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
            adjacency: Vec::new(),
            key_to_node: FxHashMap::default(),
        }
    }

    /// Builds a dual graph from a cell complex.
    ///
    /// Each cell becomes a node. Two nodes are connected if their cells share
    /// a face. Edge weight = shared face area (useful for spatial reasoning:
    /// larger shared faces indicate stronger connectivity).
    pub fn from_cell_complex(arena: &TopologyArena, complex: CellComplexKey) -> Option<Self> {
        let cc = arena.cell_complex(complex)?;
        let mut graph = Self::new();

        // Add nodes for each cell
        for &ck in &cc.cells {
            let key = TopologyKey::Cell(ck);
            let dict = arena.get_dictionary(key).cloned().unwrap_or_default();
            graph.add_node(key, dict);
        }

        // Add edges for shared faces
        for i in 0..cc.cells.len() {
            for j in (i + 1)..cc.cells.len() {
                let shared = arena.shared_faces(cc.cells[i], cc.cells[j]);
                if !shared.is_empty() {
                    // Weight = total area of shared faces
                    let total_area: f64 = shared
                        .iter()
                        .filter_map(|&fk| arena.face_area(fk))
                        .sum();

                    let face_key = if shared.len() == 1 {
                        Some(TopologyKey::Face(shared[0]))
                    } else {
                        None
                    };

                    graph.add_edge(i, j, total_area, face_key);
                }
            }
        }

        Some(graph)
    }

    /// Builds a graph from topology vertices and edges.
    ///
    /// Each vertex becomes a node, each edge becomes a graph edge with
    /// weight equal to the edge length.
    pub fn from_vertices_edges(
        arena: &TopologyArena,
        vertices: &[VertexKey],
        edges: &[EdgeKey],
    ) -> Option<Self> {
        let mut graph = Self::new();

        for &vk in vertices {
            let key = TopologyKey::Vertex(vk);
            let dict = arena.get_dictionary(key).cloned().unwrap_or_default();
            graph.add_node(key, dict);
        }

        for &ek in edges {
            let (start, end) = arena.edge_vertices(ek)?;
            let start_idx = graph.node_index(TopologyKey::Vertex(start))?;
            let end_idx = graph.node_index(TopologyKey::Vertex(end))?;
            let weight = arena.edge_length(ek).unwrap_or(1.0);
            graph.add_edge(start_idx, end_idx, weight, Some(TopologyKey::Edge(ek)));
        }

        Some(graph)
    }

    // =========================================================================
    // Graph mutation
    // =========================================================================

    /// Adds a node to the graph. Returns its index.
    pub fn add_node(&mut self, key: TopologyKey, dictionary: Dictionary) -> usize {
        let idx = self.nodes.len();
        self.key_to_node.insert(key, idx);
        self.nodes.push(GraphNode {
            topology_key: key,
            dictionary,
        });
        self.adjacency.push(Vec::new());
        idx
    }

    /// Adds an undirected edge between two nodes.
    pub fn add_edge(
        &mut self,
        source: usize,
        target: usize,
        weight: f64,
        topology_key: Option<TopologyKey>,
    ) -> usize {
        let idx = self.edges.len();
        self.edges.push(GraphEdge {
            source,
            target,
            weight,
            topology_key,
        });
        self.adjacency[source].push((target, idx));
        self.adjacency[target].push((source, idx));
        idx
    }

    // =========================================================================
    // Graph accessors
    // =========================================================================

    /// Returns the number of nodes.
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    /// Returns the number of edges.
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    /// Returns the node index for a topology key.
    pub fn node_index(&self, key: TopologyKey) -> Option<usize> {
        self.key_to_node.get(&key).copied()
    }

    /// Returns the neighbors of a node as (neighbor_index, edge_weight) pairs.
    pub fn neighbors(&self, node: usize) -> Vec<(usize, f64)> {
        self.adjacency[node]
            .iter()
            .map(|&(neighbor, edge_idx)| (neighbor, self.edges[edge_idx].weight))
            .collect()
    }

    /// Returns adjacent node indices.
    pub fn adjacent_nodes(&self, node: usize) -> Vec<usize> {
        self.adjacency[node]
            .iter()
            .map(|&(neighbor, _)| neighbor)
            .collect()
    }

    /// Returns the degree (number of connections) of a node.
    pub fn degree(&self, node: usize) -> usize {
        self.adjacency[node].len()
    }

    /// Returns the degree sequence (sorted descending).
    pub fn degree_sequence(&self) -> Vec<usize> {
        let mut seq: Vec<usize> = (0..self.node_count()).map(|n| self.degree(n)).collect();
        seq.sort_unstable_by(|a, b| b.cmp(a));
        seq
    }

    /// Returns the graph density (ratio of actual edges to possible edges).
    pub fn density(&self) -> f64 {
        let n = self.node_count();
        if n < 2 {
            return 0.0;
        }
        let max_edges = n * (n - 1) / 2;
        self.edge_count() as f64 / max_edges as f64
    }

    /// Returns isolated nodes (degree 0).
    pub fn isolated_nodes(&self) -> Vec<usize> {
        (0..self.node_count())
            .filter(|&n| self.degree(n) == 0)
            .collect()
    }

    /// Checks if the graph is complete (every node connected to every other).
    pub fn is_complete(&self) -> bool {
        let n = self.node_count();
        if n < 2 {
            return true;
        }
        self.edge_count() == n * (n - 1) / 2
    }

    // =========================================================================
    // Path finding
    // =========================================================================

    /// Dijkstra's shortest path from source to target.
    ///
    /// Returns `(total_cost, path_node_indices)` or `None` if no path exists.
    pub fn shortest_path(&self, source: usize, target: usize) -> Option<(f64, Vec<usize>)> {
        let n = self.node_count();
        let mut dist = vec![f64::INFINITY; n];
        let mut prev = vec![None; n];
        let mut heap = BinaryHeap::new();

        dist[source] = 0.0;
        heap.push(DijkstraState {
            cost: 0.0,
            node: source,
        });

        while let Some(DijkstraState { cost, node }) = heap.pop() {
            if node == target {
                break;
            }
            if cost > dist[node] {
                continue;
            }

            for &(neighbor, edge_idx) in &self.adjacency[node] {
                let next_cost = cost + self.edges[edge_idx].weight;
                if next_cost < dist[neighbor] {
                    dist[neighbor] = next_cost;
                    prev[neighbor] = Some(node);
                    heap.push(DijkstraState {
                        cost: next_cost,
                        node: neighbor,
                    });
                }
            }
        }

        if dist[target].is_infinite() {
            return None;
        }

        // Reconstruct path
        let mut path = Vec::new();
        let mut current = target;
        while let Some(p) = prev[current] {
            path.push(current);
            current = p;
        }
        path.push(source);
        path.reverse();

        Some((dist[target], path))
    }

    /// BFS shortest path (unweighted — hop count).
    pub fn shortest_path_unweighted(&self, source: usize, target: usize) -> Option<Vec<usize>> {
        let n = self.node_count();
        let mut visited = vec![false; n];
        let mut prev = vec![None; n];
        let mut queue = VecDeque::new();

        visited[source] = true;
        queue.push_back(source);

        while let Some(node) = queue.pop_front() {
            if node == target {
                break;
            }

            for &(neighbor, _) in &self.adjacency[node] {
                if !visited[neighbor] {
                    visited[neighbor] = true;
                    prev[neighbor] = Some(node);
                    queue.push_back(neighbor);
                }
            }
        }

        if !visited[target] {
            return None;
        }

        let mut path = Vec::new();
        let mut current = target;
        while let Some(p) = prev[current] {
            path.push(current);
            current = p;
        }
        path.push(source);
        path.reverse();
        Some(path)
    }

    // =========================================================================
    // Connected components
    // =========================================================================

    /// Returns connected components as lists of node indices.
    pub fn connected_components(&self) -> Vec<Vec<usize>> {
        let n = self.node_count();
        let mut visited = vec![false; n];
        let mut components = Vec::new();

        for start in 0..n {
            if visited[start] {
                continue;
            }

            let mut component = Vec::new();
            let mut queue = VecDeque::new();
            visited[start] = true;
            queue.push_back(start);

            while let Some(node) = queue.pop_front() {
                component.push(node);
                for &(neighbor, _) in &self.adjacency[node] {
                    if !visited[neighbor] {
                        visited[neighbor] = true;
                        queue.push_back(neighbor);
                    }
                }
            }

            components.push(component);
        }

        components
    }

    /// Checks if the graph is connected (exactly one component).
    pub fn is_connected(&self) -> bool {
        self.connected_components().len() <= 1
    }

    /// Returns the diameter of the graph (longest shortest path between any two nodes).
    ///
    /// Uses BFS from every node. Returns `None` if the graph is not connected.
    pub fn diameter(&self) -> Option<usize> {
        if !self.is_connected() {
            return None;
        }

        let n = self.node_count();
        let mut max_dist = 0;

        for start in 0..n {
            let distances = self.bfs_distances(start);
            for &d in &distances {
                if d < usize::MAX && d > max_dist {
                    max_dist = d;
                }
            }
        }

        Some(max_dist)
    }

    // =========================================================================
    // Centrality measures
    // =========================================================================

    /// Degree centrality for each node.
    ///
    /// Normalized to [0, 1] where 1 means connected to every other node.
    pub fn degree_centrality(&self) -> Vec<f64> {
        let n = self.node_count();
        if n < 2 {
            return vec![0.0; n];
        }
        let max_degree = (n - 1) as f64;
        (0..n).map(|i| self.degree(i) as f64 / max_degree).collect()
    }

    /// Closeness centrality for each node.
    ///
    /// `C(v) = (n-1) / sum(shortest_path_distance(v, u))` for all u != v.
    /// Higher values = more central. Returns 0 for disconnected nodes.
    pub fn closeness_centrality(&self) -> Vec<f64> {
        let n = self.node_count();
        let mut centrality = vec![0.0; n];

        for i in 0..n {
            let distances = self.bfs_distances(i);
            let total_dist: usize = distances
                .iter()
                .filter(|&&d| d > 0 && d < usize::MAX)
                .sum();

            if total_dist > 0 {
                let reachable = distances.iter().filter(|&&d| d < usize::MAX).count() - 1;
                centrality[i] = reachable as f64 / total_dist as f64;
            }
        }

        centrality
    }

    /// Betweenness centrality for each node.
    ///
    /// Counts how many shortest paths between all pairs pass through each node.
    /// Normalized to [0, 1]. Higher values = more "bridge" nodes.
    pub fn betweenness_centrality(&self) -> Vec<f64> {
        let n = self.node_count();
        let mut centrality = vec![0.0; n];

        for s in 0..n {
            // BFS from s
            let mut stack = Vec::new();
            let mut pred: Vec<Vec<usize>> = vec![Vec::new(); n];
            let mut sigma = vec![0.0_f64; n]; // number of shortest paths
            let mut dist = vec![-1_i64; n];
            let mut queue = VecDeque::new();

            sigma[s] = 1.0;
            dist[s] = 0;
            queue.push_back(s);

            while let Some(v) = queue.pop_front() {
                stack.push(v);
                for &(w, _) in &self.adjacency[v] {
                    // first visit?
                    if dist[w] < 0 {
                        dist[w] = dist[v] + 1;
                        queue.push_back(w);
                    }
                    // shortest path to w via v?
                    if dist[w] == dist[v] + 1 {
                        sigma[w] += sigma[v];
                        pred[w].push(v);
                    }
                }
            }

            // Back-propagation
            let mut delta = vec![0.0_f64; n];
            while let Some(w) = stack.pop() {
                for &v in &pred[w] {
                    delta[v] += (sigma[v] / sigma[w]) * (1.0 + delta[w]);
                }
                if w != s {
                    centrality[w] += delta[w];
                }
            }
        }

        // Normalize (undirected graph)
        let norm = if n > 2 {
            ((n - 1) * (n - 2)) as f64
        } else {
            1.0
        };

        for c in &mut centrality {
            *c /= norm;
        }

        centrality
    }

    // =========================================================================
    // Minimum spanning tree
    // =========================================================================

    /// Computes the minimum spanning tree using Kruskal's algorithm.
    ///
    /// Returns the edge indices that form the MST.
    pub fn minimum_spanning_tree(&self) -> Vec<usize> {
        let n = self.node_count();
        let mut parent: Vec<usize> = (0..n).collect();
        let mut rank = vec![0usize; n];

        fn find(parent: &mut [usize], x: usize) -> usize {
            if parent[x] != x {
                parent[x] = find(parent, parent[x]);
            }
            parent[x]
        }

        fn union(parent: &mut [usize], rank: &mut [usize], x: usize, y: usize) -> bool {
            let rx = find(parent, x);
            let ry = find(parent, y);
            if rx == ry {
                return false;
            }
            if rank[rx] < rank[ry] {
                parent[rx] = ry;
            } else if rank[rx] > rank[ry] {
                parent[ry] = rx;
            } else {
                parent[ry] = rx;
                rank[rx] += 1;
            }
            true
        }

        // Sort edges by weight
        let mut edge_indices: Vec<usize> = (0..self.edges.len()).collect();
        edge_indices.sort_by(|&a, &b| {
            self.edges[a]
                .weight
                .partial_cmp(&self.edges[b].weight)
                .unwrap_or(Ordering::Equal)
        });

        let mut mst = Vec::new();
        for &ei in &edge_indices {
            let e = &self.edges[ei];
            if union(&mut parent, &mut rank, e.source, e.target) {
                mst.push(ei);
                if mst.len() == n - 1 {
                    break;
                }
            }
        }

        mst
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    /// BFS distance from a source to all other nodes.
    fn bfs_distances(&self, source: usize) -> Vec<usize> {
        let n = self.node_count();
        let mut dist = vec![usize::MAX; n];
        let mut queue = VecDeque::new();

        dist[source] = 0;
        queue.push_back(source);

        while let Some(node) = queue.pop_front() {
            for &(neighbor, _) in &self.adjacency[node] {
                if dist[neighbor] == usize::MAX {
                    dist[neighbor] = dist[node] + 1;
                    queue.push_back(neighbor);
                }
            }
        }

        dist
    }
}

impl Default for TopologyGraph {
    fn default() -> Self {
        Self::new()
    }
}

/// Internal state for Dijkstra's priority queue (min-heap by cost).
#[derive(Debug, Clone, PartialEq)]
struct DijkstraState {
    cost: f64,
    node: usize,
}

impl Eq for DijkstraState {}

impl PartialOrd for DijkstraState {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for DijkstraState {
    fn cmp(&self, other: &Self) -> Ordering {
        // Reverse ordering for min-heap
        other
            .cost
            .partial_cmp(&self.cost)
            .unwrap_or(Ordering::Equal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_linear_graph() -> TopologyGraph {
        // 0 --1-- 1 --2-- 2 --3-- 3
        let mut g = TopologyGraph::new();
        let mut arena = TopologyArena::new();
        for _ in 0..4 {
            let vk = arena.add_vertex(0.0, 0.0, 0.0);
            g.add_node(TopologyKey::Vertex(vk), Dictionary::default());
        }
        g.add_edge(0, 1, 1.0, None);
        g.add_edge(1, 2, 2.0, None);
        g.add_edge(2, 3, 3.0, None);
        g
    }

    fn make_triangle_graph() -> TopologyGraph {
        // 0 --1-- 1
        // |       |
        // 2---1---2
        let mut g = TopologyGraph::new();
        let mut arena = TopologyArena::new();
        for _ in 0..3 {
            let vk = arena.add_vertex(0.0, 0.0, 0.0);
            g.add_node(TopologyKey::Vertex(vk), Dictionary::default());
        }
        g.add_edge(0, 1, 1.0, None);
        g.add_edge(1, 2, 1.0, None);
        g.add_edge(0, 2, 2.0, None);
        g
    }

    #[test]
    fn graph_basic_properties() {
        let g = make_linear_graph();
        assert_eq!(g.node_count(), 4);
        assert_eq!(g.edge_count(), 3);
        assert_eq!(g.degree(0), 1);
        assert_eq!(g.degree(1), 2);
        assert_eq!(g.degree(3), 1);
    }

    #[test]
    fn degree_sequence() {
        let g = make_linear_graph();
        assert_eq!(g.degree_sequence(), vec![2, 2, 1, 1]);
    }

    #[test]
    fn graph_density() {
        let g = make_triangle_graph();
        // 3 edges out of max 3 → density = 1.0
        assert!((g.density() - 1.0).abs() < 1e-10);

        let g2 = make_linear_graph();
        // 3 edges out of max 6 → density = 0.5
        assert!((g2.density() - 0.5).abs() < 1e-10);
    }

    #[test]
    fn is_complete() {
        assert!(make_triangle_graph().is_complete());
        assert!(!make_linear_graph().is_complete());
    }

    #[test]
    fn isolated_nodes() {
        let mut g = TopologyGraph::new();
        let mut arena = TopologyArena::new();
        for _ in 0..3 {
            let vk = arena.add_vertex(0.0, 0.0, 0.0);
            g.add_node(TopologyKey::Vertex(vk), Dictionary::default());
        }
        g.add_edge(0, 1, 1.0, None);

        assert_eq!(g.isolated_nodes(), vec![2]);
    }

    #[test]
    fn dijkstra_shortest_path() {
        let g = make_linear_graph();
        let (cost, path) = g.shortest_path(0, 3).unwrap();
        assert!((cost - 6.0).abs() < 1e-10); // 1 + 2 + 3
        assert_eq!(path, vec![0, 1, 2, 3]);
    }

    #[test]
    fn dijkstra_prefers_shorter_path() {
        let g = make_triangle_graph();
        // Direct path 0→2 costs 2.0, indirect 0→1→2 costs 1.0+1.0=2.0
        let (cost, path) = g.shortest_path(0, 2).unwrap();
        assert!((cost - 2.0).abs() < 1e-10);
        // Both paths cost the same, either is valid
        assert!(path.len() == 2 || path.len() == 3);
    }

    #[test]
    fn bfs_unweighted_path() {
        let g = make_linear_graph();
        let path = g.shortest_path_unweighted(0, 3).unwrap();
        assert_eq!(path, vec![0, 1, 2, 3]);
    }

    #[test]
    fn connected_components_single() {
        let g = make_linear_graph();
        let cc = g.connected_components();
        assert_eq!(cc.len(), 1);
        assert_eq!(cc[0].len(), 4);
    }

    #[test]
    fn connected_components_multiple() {
        let mut g = TopologyGraph::new();
        let mut arena = TopologyArena::new();
        for _ in 0..4 {
            let vk = arena.add_vertex(0.0, 0.0, 0.0);
            g.add_node(TopologyKey::Vertex(vk), Dictionary::default());
        }
        g.add_edge(0, 1, 1.0, None);
        g.add_edge(2, 3, 1.0, None);

        let cc = g.connected_components();
        assert_eq!(cc.len(), 2);
    }

    #[test]
    fn is_connected() {
        assert!(make_linear_graph().is_connected());
    }

    #[test]
    fn diameter() {
        let g = make_linear_graph();
        assert_eq!(g.diameter(), Some(3));

        let g2 = make_triangle_graph();
        assert_eq!(g2.diameter(), Some(1));
    }

    #[test]
    fn degree_centrality() {
        let g = make_triangle_graph();
        let dc = g.degree_centrality();
        // All nodes have degree 2, max = 2, so centrality = 1.0
        for c in &dc {
            assert!((*c - 1.0).abs() < 1e-10);
        }
    }

    #[test]
    fn closeness_centrality() {
        let g = make_linear_graph();
        let cc = g.closeness_centrality();
        // Node 0: distances [0,1,2,3], sum=6, closeness=3/6=0.5
        assert!((cc[0] - 0.5).abs() < 1e-10);
        // Node 1: distances [1,0,1,2], sum=4, closeness=3/4=0.75
        assert!((cc[1] - 0.75).abs() < 1e-10);
    }

    #[test]
    fn betweenness_centrality() {
        let g = make_linear_graph();
        let bc = g.betweenness_centrality();
        // End nodes have 0 betweenness
        assert!((bc[0]).abs() < 1e-10);
        assert!((bc[3]).abs() < 1e-10);
        // Middle nodes have non-zero betweenness
        assert!(bc[1] > 0.0);
        assert!(bc[2] > 0.0);
    }

    #[test]
    fn minimum_spanning_tree() {
        let g = make_triangle_graph();
        let mst = g.minimum_spanning_tree();
        // 3 nodes → 2 edges in MST
        assert_eq!(mst.len(), 2);
        // MST weight should be 2.0 (the two edges of weight 1.0)
        let total: f64 = mst.iter().map(|&i| g.edges[i].weight).sum();
        assert!((total - 2.0).abs() < 1e-10);
    }

    #[test]
    fn graph_from_cell_complex() {
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

        let graph = TopologyGraph::from_cell_complex(&arena, complex).unwrap();

        assert_eq!(graph.node_count(), 2); // 2 cells = 2 rooms
        assert_eq!(graph.edge_count(), 1); // 1 shared face = 1 wall

        // Edge weight should be the area of the shared face (1.0 × 1.0 = 1.0)
        assert!((graph.edges[0].weight - 1.0).abs() < 0.01);

        // Both rooms are adjacent
        let adj = graph.adjacent_nodes(0);
        assert_eq!(adj.len(), 1);
        assert_eq!(adj[0], 1);
    }

    #[test]
    fn graph_path_between_rooms() {
        // Three rooms in a row: A-B-C
        let mut arena = TopologyArena::new();
        let complex = arena
            .add_cell_complex_by_cells(
                &[
                    // Room A: [0,1]×[0,1]×[0,1]
                    vec![
                        vec![[0., 0., 0.], [1., 0., 0.], [1., 1., 0.], [0., 1., 0.]],
                        vec![[0., 0., 1.], [1., 0., 1.], [1., 1., 1.], [0., 1., 1.]],
                        vec![[0., 0., 0.], [1., 0., 0.], [1., 0., 1.], [0., 0., 1.]],
                        vec![[0., 1., 0.], [1., 1., 0.], [1., 1., 1.], [0., 1., 1.]],
                        vec![[0., 0., 0.], [0., 1., 0.], [0., 1., 1.], [0., 0., 1.]],
                        vec![[1., 0., 0.], [1., 1., 0.], [1., 1., 1.], [1., 0., 1.]],
                    ],
                    // Room B: [1,2]×[0,1]×[0,1]
                    vec![
                        vec![[1., 0., 0.], [2., 0., 0.], [2., 1., 0.], [1., 1., 0.]],
                        vec![[1., 0., 1.], [2., 0., 1.], [2., 1., 1.], [1., 1., 1.]],
                        vec![[1., 0., 0.], [2., 0., 0.], [2., 0., 1.], [1., 0., 1.]],
                        vec![[1., 1., 0.], [2., 1., 0.], [2., 1., 1.], [1., 1., 1.]],
                        vec![[1., 0., 0.], [1., 1., 0.], [1., 1., 1.], [1., 0., 1.]],
                        vec![[2., 0., 0.], [2., 1., 0.], [2., 1., 1.], [2., 0., 1.]],
                    ],
                    // Room C: [2,3]×[0,1]×[0,1]
                    vec![
                        vec![[2., 0., 0.], [3., 0., 0.], [3., 1., 0.], [2., 1., 0.]],
                        vec![[2., 0., 1.], [3., 0., 1.], [3., 1., 1.], [2., 1., 1.]],
                        vec![[2., 0., 0.], [3., 0., 0.], [3., 0., 1.], [2., 0., 1.]],
                        vec![[2., 1., 0.], [3., 1., 0.], [3., 1., 1.], [2., 1., 1.]],
                        vec![[2., 0., 0.], [2., 1., 0.], [2., 1., 1.], [2., 0., 1.]],
                        vec![[3., 0., 0.], [3., 1., 0.], [3., 1., 1.], [3., 0., 1.]],
                    ],
                ],
                0.001,
            )
            .unwrap();

        let graph = TopologyGraph::from_cell_complex(&arena, complex).unwrap();

        assert_eq!(graph.node_count(), 3);
        assert_eq!(graph.edge_count(), 2); // A-B and B-C

        // Path from room A to room C goes through B
        let path = graph.shortest_path_unweighted(0, 2).unwrap();
        assert_eq!(path.len(), 3); // A → B → C
    }
}
