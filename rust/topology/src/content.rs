// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Content, Context, and Aperture system for IFC spatial structure.
//!
//! In IFC models, spatial elements have containment and adjacency relationships:
//! - A **content** is a topology entity placed inside another (e.g., furniture
//!   inside a room, a window inside a wall).
//! - A **context** is the parametric position (u, v, w) where a content sits
//!   relative to its host.
//! - An **aperture** is a special content that represents an opening (door,
//!   window) in a face, connecting two spaces.
//!
//! This maps directly to IFC relationships:
//! - `IfcRelContainedInSpatialStructure` → contents
//! - `IfcRelVoidsElement` → apertures (openings)
//! - `IfcRelFillsElement` → apertures (doors/windows filling openings)

use crate::arena::TopologyArena;
use crate::keys::*;

/// A parametric position (u, v, w) on a host topology.
#[derive(Debug, Clone, Copy)]
pub struct ContextCoordinates {
    pub u: f64,
    pub v: f64,
    pub w: f64,
}

/// An aperture is a topology entity (usually a Face) that acts as an opening
/// in a host face, connecting two adjacent cells.
#[derive(Debug, Clone)]
pub struct Aperture {
    /// The topology entity representing the aperture geometry.
    pub topology: TopologyKey,
    /// The host face this aperture belongs to.
    pub host_face: FaceKey,
}

impl TopologyArena {
    /// Adds a content to a host topology.
    pub fn add_content(
        &mut self,
        host: TopologyKey,
        content: TopologyKey,
        context: Option<ContextCoordinates>,
    ) {
        self.contents
            .entry(host)
            .or_default()
            .push((content, context));
    }

    /// Returns the contents of a host topology.
    pub fn contents(&self, host: TopologyKey) -> &[(TopologyKey, Option<ContextCoordinates>)] {
        self.contents
            .get(&host)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Returns the context (host) that a content belongs to.
    pub fn context_of(&self, content: TopologyKey) -> Option<TopologyKey> {
        for (&host, contents) in &self.contents {
            if contents.iter().any(|(c, _)| *c == content) {
                return Some(host);
            }
        }
        None
    }

    /// Adds an aperture to a face.
    pub fn add_aperture(&mut self, host_face: FaceKey, aperture_topology: TopologyKey) {
        self.apertures
            .entry(host_face)
            .or_default()
            .push(Aperture {
                topology: aperture_topology,
                host_face,
            });
    }

    /// Returns the apertures on a face.
    pub fn apertures(&self, face: FaceKey) -> &[Aperture] {
        self.apertures
            .get(&face)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Returns all apertures in a cell (across all its faces).
    pub fn cell_apertures(&self, cell: CellKey) -> Vec<&Aperture> {
        let mut result = Vec::new();
        if let Some(faces) = self.cell_faces(cell) {
            for fk in faces {
                if let Some(apts) = self.apertures.get(&fk) {
                    result.extend(apts.iter());
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_get_contents() {
        let mut arena = TopologyArena::new();
        let (cell, _, _) = arena.make_box([0.0, 0.0, 0.0], [5.0, 5.0, 3.0]).unwrap();
        let furniture = arena.add_vertex(2.5, 2.5, 0.0);

        arena.add_content(
            TopologyKey::Cell(cell),
            TopologyKey::Vertex(furniture),
            Some(ContextCoordinates {
                u: 0.5,
                v: 0.5,
                w: 0.0,
            }),
        );

        let contents = arena.contents(TopologyKey::Cell(cell));
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0].0, TopologyKey::Vertex(furniture));
    }

    #[test]
    fn context_of_content() {
        let mut arena = TopologyArena::new();
        let (cell, _, _) = arena.make_box([0.0, 0.0, 0.0], [5.0, 5.0, 3.0]).unwrap();
        let obj = arena.add_vertex(1.0, 1.0, 1.0);

        arena.add_content(TopologyKey::Cell(cell), TopologyKey::Vertex(obj), None);

        let ctx = arena.context_of(TopologyKey::Vertex(obj));
        assert_eq!(ctx, Some(TopologyKey::Cell(cell)));
    }

    #[test]
    fn apertures_on_face() {
        let mut arena = TopologyArena::new();
        let (_, _, faces) = arena.make_box([0.0, 0.0, 0.0], [5.0, 5.0, 3.0]).unwrap();

        // Add a window aperture to the front face
        let window = arena.add_vertex(2.5, 0.0, 1.5);
        arena.add_aperture(faces[2], TopologyKey::Vertex(window));

        let apts = arena.apertures(faces[2]);
        assert_eq!(apts.len(), 1);
        assert_eq!(apts[0].topology, TopologyKey::Vertex(window));
        assert_eq!(apts[0].host_face, faces[2]);
    }

    #[test]
    fn cell_apertures_aggregates() {
        let mut arena = TopologyArena::new();
        let (cell, _, faces) = arena.make_box([0.0, 0.0, 0.0], [5.0, 5.0, 3.0]).unwrap();

        // Window on face 2
        let window = arena.add_vertex(2.5, 0.0, 1.5);
        arena.add_aperture(faces[2], TopologyKey::Vertex(window));

        // Door on face 4
        let door = arena.add_vertex(0.0, 2.5, 1.0);
        arena.add_aperture(faces[4], TopologyKey::Vertex(door));

        let all_apts = arena.cell_apertures(cell);
        assert_eq!(all_apts.len(), 2);
    }
}
