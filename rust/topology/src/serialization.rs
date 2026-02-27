// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! JSON serialization for topology arenas.
//!
//! Provides full round-trip serialization of the arena's topology entities,
//! adjacency indices, and dictionaries. The format is designed for portability
//! between Rust (native/WASM) and TypeScript consumers.

use serde::{Deserialize, Serialize};

use crate::arena::*;
use crate::dictionary::Dictionary;
use crate::error::{Error, Result};

/// Serializable representation of the full topology arena.
#[derive(Debug, Serialize, Deserialize)]
pub struct ArenaSnapshot {
    pub vertices: Vec<VertexSnapshot>,
    pub edges: Vec<EdgeSnapshot>,
    pub wires: Vec<WireSnapshot>,
    pub faces: Vec<FaceSnapshot>,
    pub shells: Vec<ShellSnapshot>,
    pub cells: Vec<CellSnapshot>,
    pub cell_complexes: Vec<CellComplexSnapshot>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VertexSnapshot {
    pub id: usize,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dictionary: Option<Dictionary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EdgeSnapshot {
    pub id: usize,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WireSnapshot {
    pub id: usize,
    pub edges: Vec<usize>,
    pub orientations: Vec<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FaceSnapshot {
    pub id: usize,
    pub outer_wire: usize,
    pub inner_wires: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dictionary: Option<Dictionary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellSnapshot {
    pub id: usize,
    pub faces: Vec<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CellSnapshot {
    pub id: usize,
    pub outer_shell: usize,
    pub inner_shells: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dictionary: Option<Dictionary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CellComplexSnapshot {
    pub id: usize,
    pub cells: Vec<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dictionary: Option<Dictionary>,
}

impl TopologyArena {
    /// Serializes the arena to a JSON string.
    pub fn to_json(&self) -> Result<String> {
        let snapshot = self.to_snapshot();
        serde_json::to_string_pretty(&snapshot).map_err(|e| Error::Serialization(e.to_string()))
    }

    /// Creates a serializable snapshot of the arena.
    ///
    /// SlotMap keys are mapped to sequential integer IDs for portability.
    fn to_snapshot(&self) -> ArenaSnapshot {
        use rustc_hash::FxHashMap;

        // Build key → sequential ID mappings
        let mut vertex_ids = FxHashMap::default();
        let mut edge_ids = FxHashMap::default();
        let mut wire_ids = FxHashMap::default();
        let mut face_ids = FxHashMap::default();
        let mut shell_ids = FxHashMap::default();
        let mut cell_ids = FxHashMap::default();
        let mut cc_ids = FxHashMap::default();

        let vertices: Vec<VertexSnapshot> = self
            .vertices
            .iter()
            .enumerate()
            .map(|(i, (k, v))| {
                vertex_ids.insert(k, i);
                VertexSnapshot {
                    id: i,
                    x: v.x,
                    y: v.y,
                    z: v.z,
                    dictionary: self
                        .dictionaries
                        .get(&crate::keys::TopologyKey::Vertex(k))
                        .cloned(),
                }
            })
            .collect();

        let edges: Vec<EdgeSnapshot> = self
            .edges
            .iter()
            .enumerate()
            .map(|(i, (k, e))| {
                edge_ids.insert(k, i);
                EdgeSnapshot {
                    id: i,
                    start: vertex_ids[&e.start],
                    end: vertex_ids[&e.end],
                }
            })
            .collect();

        let wires: Vec<WireSnapshot> = self
            .wires
            .iter()
            .enumerate()
            .map(|(i, (k, w))| {
                wire_ids.insert(k, i);
                WireSnapshot {
                    id: i,
                    edges: w.edges.iter().map(|ek| edge_ids[ek]).collect(),
                    orientations: w.orientations.clone(),
                }
            })
            .collect();

        let faces: Vec<FaceSnapshot> = self
            .faces
            .iter()
            .enumerate()
            .map(|(i, (k, f))| {
                face_ids.insert(k, i);
                FaceSnapshot {
                    id: i,
                    outer_wire: wire_ids[&f.outer_wire],
                    inner_wires: f.inner_wires.iter().map(|wk| wire_ids[wk]).collect(),
                    dictionary: self
                        .dictionaries
                        .get(&crate::keys::TopologyKey::Face(k))
                        .cloned(),
                }
            })
            .collect();

        let shells: Vec<ShellSnapshot> = self
            .shells
            .iter()
            .enumerate()
            .map(|(i, (k, s))| {
                shell_ids.insert(k, i);
                ShellSnapshot {
                    id: i,
                    faces: s.faces.iter().map(|fk| face_ids[fk]).collect(),
                }
            })
            .collect();

        let cells: Vec<CellSnapshot> = self
            .cells
            .iter()
            .enumerate()
            .map(|(i, (k, c))| {
                cell_ids.insert(k, i);
                CellSnapshot {
                    id: i,
                    outer_shell: shell_ids[&c.outer_shell],
                    inner_shells: c.inner_shells.iter().map(|sk| shell_ids[sk]).collect(),
                    dictionary: self
                        .dictionaries
                        .get(&crate::keys::TopologyKey::Cell(k))
                        .cloned(),
                }
            })
            .collect();

        let cell_complexes: Vec<CellComplexSnapshot> = self
            .cell_complexes
            .iter()
            .enumerate()
            .map(|(i, (k, cc))| {
                cc_ids.insert(k, i);
                CellComplexSnapshot {
                    id: i,
                    cells: cc.cells.iter().map(|ck| cell_ids[ck]).collect(),
                    dictionary: self
                        .dictionaries
                        .get(&crate::keys::TopologyKey::CellComplex(k))
                        .cloned(),
                }
            })
            .collect();

        ArenaSnapshot {
            vertices,
            edges,
            wires,
            faces,
            shells,
            cells,
            cell_complexes,
        }
    }

    /// Deserializes an arena from a JSON string.
    pub fn from_json(json: &str) -> Result<Self> {
        let snapshot: ArenaSnapshot =
            serde_json::from_str(json).map_err(|e| Error::Serialization(e.to_string()))?;
        Self::from_snapshot(&snapshot)
    }

    /// Reconstructs an arena from a snapshot.
    fn from_snapshot(snap: &ArenaSnapshot) -> Result<Self> {
        use crate::keys::TopologyKey;

        let mut arena = TopologyArena::new();

        // Rebuild vertices (id → VertexKey mapping)
        let mut vertex_keys: Vec<crate::keys::VertexKey> = Vec::with_capacity(snap.vertices.len());
        for vs in &snap.vertices {
            let vk = arena.add_vertex(vs.x, vs.y, vs.z);
            if let Some(ref dict) = vs.dictionary {
                arena.set_dictionary(TopologyKey::Vertex(vk), dict.clone());
            }
            vertex_keys.push(vk);
        }

        // Rebuild edges
        let mut edge_keys: Vec<crate::keys::EdgeKey> = Vec::with_capacity(snap.edges.len());
        for es in &snap.edges {
            let ek = arena.add_edge(vertex_keys[es.start], vertex_keys[es.end])?;
            edge_keys.push(ek);
        }

        // Rebuild wires
        let mut wire_keys: Vec<crate::keys::WireKey> = Vec::with_capacity(snap.wires.len());
        for ws in &snap.wires {
            let edges: Vec<crate::keys::EdgeKey> = ws.edges.iter().map(|&i| edge_keys[i]).collect();
            let wk = arena.add_wire(&edges)?;
            wire_keys.push(wk);
        }

        // Rebuild faces
        let mut face_keys: Vec<crate::keys::FaceKey> = Vec::with_capacity(snap.faces.len());
        for fs in &snap.faces {
            let inner: Vec<crate::keys::WireKey> =
                fs.inner_wires.iter().map(|&i| wire_keys[i]).collect();
            let fk = if inner.is_empty() {
                arena.add_face(wire_keys[fs.outer_wire])?
            } else {
                arena.add_face_with_holes(wire_keys[fs.outer_wire], &inner)?
            };
            if let Some(ref dict) = fs.dictionary {
                arena.set_dictionary(TopologyKey::Face(fk), dict.clone());
            }
            face_keys.push(fk);
        }

        // Rebuild shells
        let mut shell_keys: Vec<crate::keys::ShellKey> = Vec::with_capacity(snap.shells.len());
        for ss in &snap.shells {
            let faces: Vec<crate::keys::FaceKey> = ss.faces.iter().map(|&i| face_keys[i]).collect();
            let sk = arena.add_shell(&faces)?;
            shell_keys.push(sk);
        }

        // Rebuild cells
        let mut cell_keys: Vec<crate::keys::CellKey> = Vec::with_capacity(snap.cells.len());
        for cs in &snap.cells {
            let inner: Vec<crate::keys::ShellKey> =
                cs.inner_shells.iter().map(|&i| shell_keys[i]).collect();
            let ck = if inner.is_empty() {
                arena.add_cell(shell_keys[cs.outer_shell])?
            } else {
                arena.add_cell_with_voids(shell_keys[cs.outer_shell], &inner)?
            };
            if let Some(ref dict) = cs.dictionary {
                arena.set_dictionary(TopologyKey::Cell(ck), dict.clone());
            }
            cell_keys.push(ck);
        }

        // Rebuild cell complexes
        for ccs in &snap.cell_complexes {
            let cells: Vec<crate::keys::CellKey> =
                ccs.cells.iter().map(|&i| cell_keys[i]).collect();
            let cck = arena.add_cell_complex(&cells)?;
            if let Some(ref dict) = ccs.dictionary {
                arena.set_dictionary(TopologyKey::CellComplex(cck), dict.clone());
            }
        }

        Ok(arena)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::construction::make_rectangle;
    use crate::dictionary::DictValue;

    #[test]
    fn roundtrip_empty_arena() {
        let arena = TopologyArena::new();
        let json = arena.to_json().unwrap();
        let restored = TopologyArena::from_json(&json).unwrap();

        assert_eq!(restored.vertex_count(), 0);
        assert_eq!(restored.edge_count(), 0);
    }

    #[test]
    fn roundtrip_vertices_only() {
        let mut arena = TopologyArena::new();
        arena.add_vertex(1.0, 2.0, 3.0);
        arena.add_vertex(4.0, 5.0, 6.0);

        let json = arena.to_json().unwrap();
        let restored = TopologyArena::from_json(&json).unwrap();

        assert_eq!(restored.vertex_count(), 2);
    }

    #[test]
    fn roundtrip_single_face() {
        let mut arena = TopologyArena::new();
        let v0 = arena.add_vertex(0.0, 0.0, 0.0);
        let v1 = arena.add_vertex(1.0, 0.0, 0.0);
        let v2 = arena.add_vertex(1.0, 1.0, 0.0);
        let v3 = arena.add_vertex(0.0, 1.0, 0.0);
        make_rectangle(&mut arena, v0, v1, v2, v3).unwrap();

        let json = arena.to_json().unwrap();
        let restored = TopologyArena::from_json(&json).unwrap();

        assert_eq!(restored.vertex_count(), 4);
        assert_eq!(restored.edge_count(), 4);
        assert_eq!(restored.wire_count(), 1);
        assert_eq!(restored.face_count(), 1);
    }

    #[test]
    fn roundtrip_box_cell() {
        let mut arena = TopologyArena::new();

        let v = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(1.0, 0.0, 0.0),
            arena.add_vertex(1.0, 1.0, 0.0),
            arena.add_vertex(0.0, 1.0, 0.0),
            arena.add_vertex(0.0, 0.0, 1.0),
            arena.add_vertex(1.0, 0.0, 1.0),
            arena.add_vertex(1.0, 1.0, 1.0),
            arena.add_vertex(0.0, 1.0, 1.0),
        ];

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[3], v[2], v[1]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[4], v[7], v[3]).unwrap();
        let (f5, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell = arena.add_shell(&[f0, f1, f2, f3, f4, f5]).unwrap();
        arena.add_cell(shell).unwrap();

        let json = arena.to_json().unwrap();
        let restored = TopologyArena::from_json(&json).unwrap();

        assert_eq!(restored.vertex_count(), 8);
        assert_eq!(restored.face_count(), 6);
        assert_eq!(restored.shell_count(), 1);
        assert_eq!(restored.cell_count(), 1);
    }

    #[test]
    fn roundtrip_with_dictionaries() {
        let mut arena = TopologyArena::new();
        let vk = arena.add_vertex(0.0, 0.0, 0.0);

        let mut dict = Dictionary::default();
        dict.insert("name".to_string(), DictValue::String("origin".to_string()));
        dict.insert("weight".to_string(), DictValue::Double(3.14));
        dict.insert(
            "tags".to_string(),
            DictValue::List(vec![
                DictValue::String("a".to_string()),
                DictValue::Int(42),
            ]),
        );
        arena.set_dictionary(crate::keys::TopologyKey::Vertex(vk), dict);

        let json = arena.to_json().unwrap();
        let restored = TopologyArena::from_json(&json).unwrap();

        assert_eq!(restored.vertex_count(), 1);

        // Find the restored vertex key (first one)
        let (restored_vk, _) = restored.vertices.iter().next().unwrap();
        let restored_dict = restored
            .get_dictionary(crate::keys::TopologyKey::Vertex(restored_vk))
            .unwrap();

        assert_eq!(
            restored_dict.get("name"),
            Some(&DictValue::String("origin".to_string()))
        );
        assert_eq!(restored_dict.get("weight"), Some(&DictValue::Double(3.14)));
    }

    #[test]
    fn roundtrip_cell_complex_with_shared_face() {
        let mut arena = TopologyArena::new();

        // Two cells sharing a face
        let v = [
            arena.add_vertex(0.0, 0.0, 0.0),
            arena.add_vertex(1.0, 0.0, 0.0),
            arena.add_vertex(1.0, 1.0, 0.0),
            arena.add_vertex(0.0, 1.0, 0.0),
            arena.add_vertex(0.0, 0.0, 1.0),
            arena.add_vertex(1.0, 0.0, 1.0),
            arena.add_vertex(1.0, 1.0, 1.0),
            arena.add_vertex(0.0, 1.0, 1.0),
        ];

        let (f0, _, _) = make_rectangle(&mut arena, v[0], v[3], v[2], v[1]).unwrap();
        let (f1, _, _) = make_rectangle(&mut arena, v[4], v[5], v[6], v[7]).unwrap();
        let (f2, _, _) = make_rectangle(&mut arena, v[0], v[1], v[5], v[4]).unwrap();
        let (f3, _, _) = make_rectangle(&mut arena, v[2], v[3], v[7], v[6]).unwrap();
        let (f4, _, _) = make_rectangle(&mut arena, v[0], v[4], v[7], v[3]).unwrap();
        let (shared, _, _) = make_rectangle(&mut arena, v[1], v[2], v[6], v[5]).unwrap();

        let shell1 = arena.add_shell(&[f0, f1, f2, f3, f4, shared]).unwrap();
        let cell1 = arena.add_cell(shell1).unwrap();

        let ve = [
            arena.add_vertex(2.0, 0.0, 0.0),
            arena.add_vertex(2.0, 1.0, 0.0),
            arena.add_vertex(2.0, 0.0, 1.0),
            arena.add_vertex(2.0, 1.0, 1.0),
        ];

        let (g0, _, _) = make_rectangle(&mut arena, v[1], ve[0], ve[1], v[2]).unwrap();
        let (g1, _, _) = make_rectangle(&mut arena, v[5], ve[2], ve[3], v[6]).unwrap();
        let (g2, _, _) = make_rectangle(&mut arena, v[1], ve[0], ve[2], v[5]).unwrap();
        let (g3, _, _) = make_rectangle(&mut arena, v[2], ve[1], ve[3], v[6]).unwrap();
        let (g4, _, _) = make_rectangle(&mut arena, ve[0], ve[1], ve[3], ve[2]).unwrap();

        let shell2 = arena.add_shell(&[g0, g1, g2, g3, g4, shared]).unwrap();
        let cell2 = arena.add_cell(shell2).unwrap();

        arena.add_cell_complex(&[cell1, cell2]).unwrap();

        let json = arena.to_json().unwrap();
        let restored = TopologyArena::from_json(&json).unwrap();

        assert_eq!(restored.vertex_count(), 12);
        assert_eq!(restored.cell_count(), 2);
        assert_eq!(restored.cell_complex_count(), 1);
    }
}
