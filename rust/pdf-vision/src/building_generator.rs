// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! 3D building generation from detected floor plans

use crate::types::{
    BuildingBounds, DetectedFloorPlan, DetectedWall, GeneratedBuilding, GeneratedStorey,
    Point2D, StoreyConfig,
};
use ifc_lite_geometry::extrusion::extrude_profile;
use ifc_lite_geometry::mesh::Mesh;
use ifc_lite_geometry::profile::Profile2D;
use nalgebra::{Matrix4, Point2, Vector3};

/// Generate a 3D building from detected floor plans and storey configurations
pub fn generate_building(
    floor_plans: &[DetectedFloorPlan],
    storey_configs: &[StoreyConfig],
) -> Result<GeneratedBuilding, BuildingError> {
    if floor_plans.is_empty() || storey_configs.is_empty() {
        return Err(BuildingError::EmptyInput);
    }

    // Sort storeys by order
    let mut sorted_configs: Vec<_> = storey_configs.to_vec();
    sorted_configs.sort_by_key(|c| c.order);

    // Calculate elevations based on stacking order
    let mut current_elevation = 0.0;
    for config in &mut sorted_configs {
        config.elevation = current_elevation;
        current_elevation += config.height;
    }

    let total_height = current_elevation;

    // Calculate building bounds
    let bounds = calculate_building_bounds(floor_plans, &sorted_configs);

    // Generate each storey
    let mut generated_storeys = Vec::with_capacity(sorted_configs.len());

    for config in &sorted_configs {
        let floor_plan = floor_plans
            .get(config.floor_plan_index)
            .ok_or(BuildingError::InvalidFloorPlanIndex(config.floor_plan_index))?;

        let storey = generate_storey(floor_plan, config)?;
        generated_storeys.push(storey);
    }

    Ok(GeneratedBuilding {
        total_height,
        bounds,
        storeys: generated_storeys,
    })
}

/// Generate a single storey with wall meshes
fn generate_storey(
    floor_plan: &DetectedFloorPlan,
    config: &StoreyConfig,
) -> Result<GeneratedStorey, BuildingError> {
    let mut all_positions: Vec<f32> = Vec::new();
    let mut all_normals: Vec<f32> = Vec::new();
    let mut all_indices: Vec<u32> = Vec::new();

    let mut wall_count = 0;

    for wall in &floor_plan.walls {
        // Convert wall to Profile2D
        let profile = wall_to_profile(wall, floor_plan.scale);

        // Create transformation to position at correct elevation
        let transform = Matrix4::new_translation(&Vector3::new(0.0, 0.0, config.elevation));

        // Extrude the profile
        let mesh = extrude_profile(&profile, config.height, Some(transform))
            .map_err(|e| BuildingError::ExtrusionError(format!("{:?}", e)))?;

        // Append mesh data
        let index_offset = (all_positions.len() / 3) as u32;
        all_positions.extend_from_slice(&mesh.positions);
        all_normals.extend_from_slice(&mesh.normals);
        all_indices.extend(mesh.indices.iter().map(|i| i + index_offset));

        wall_count += 1;
    }

    // Generate floor slab
    if let Some(slab_mesh) = generate_floor_slab(floor_plan, config) {
        let index_offset = (all_positions.len() / 3) as u32;
        all_positions.extend_from_slice(&slab_mesh.positions);
        all_normals.extend_from_slice(&slab_mesh.normals);
        all_indices.extend(slab_mesh.indices.iter().map(|i| i + index_offset));
    }

    Ok(GeneratedStorey {
        config: config.clone(),
        wall_count,
        positions: all_positions,
        normals: all_normals,
        indices: all_indices,
    })
}

/// Convert a detected wall to a Profile2D for extrusion
fn wall_to_profile(wall: &DetectedWall, scale: f64) -> Profile2D {
    if wall.centerline.len() < 2 {
        // Return a minimal profile for invalid walls
        return Profile2D::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(0.1, 0.0),
            Point2::new(0.1, 0.1),
            Point2::new(0.0, 0.1),
        ]);
    }

    let start = &wall.centerline[0];
    let end = wall.centerline.last().unwrap();

    // Calculate wall direction
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let length = (dx * dx + dy * dy).sqrt();

    if length < 1e-10 {
        // Degenerate wall
        return Profile2D::new(vec![
            Point2::new(start.x * scale, start.y * scale),
            Point2::new((start.x + 0.1) * scale, start.y * scale),
            Point2::new((start.x + 0.1) * scale, (start.y + 0.1) * scale),
            Point2::new(start.x * scale, (start.y + 0.1) * scale),
        ]);
    }

    // Perpendicular direction for thickness
    // Note: In floor plans, typically Y is "up" on screen, but in 3D we want
    // the wall to extend in X-Y plane and extrude in Z
    let half_thick = wall.thickness * scale / 2.0;
    let perp_x = -dy / length * half_thick;
    let perp_y = dx / length * half_thick;

    // Four corners of wall profile (counter-clockwise when viewed from above)
    // The profile is in the X-Y plane, extrusion goes in Z
    let outer = vec![
        Point2::new(start.x * scale - perp_x, start.y * scale - perp_y),
        Point2::new(end.x * scale - perp_x, end.y * scale - perp_y),
        Point2::new(end.x * scale + perp_x, end.y * scale + perp_y),
        Point2::new(start.x * scale + perp_x, start.y * scale + perp_y),
    ];

    Profile2D::new(outer)
}

/// Generate a floor slab from the building footprint
fn generate_floor_slab(floor_plan: &DetectedFloorPlan, config: &StoreyConfig) -> Option<Mesh> {
    // Find bounding box of all walls
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;

    for wall in &floor_plan.walls {
        for point in &wall.centerline {
            let x = point.x * floor_plan.scale;
            let y = point.y * floor_plan.scale;
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }

    if min_x >= max_x || min_y >= max_y {
        return None;
    }

    // Add small padding
    let padding = 0.1;
    min_x -= padding;
    min_y -= padding;
    max_x += padding;
    max_y += padding;

    // Create rectangular slab profile
    let slab_profile = Profile2D::new(vec![
        Point2::new(min_x, min_y),
        Point2::new(max_x, min_y),
        Point2::new(max_x, max_y),
        Point2::new(min_x, max_y),
    ]);

    // Extrude thin slab at floor level
    let slab_thickness = 0.3; // 30cm slab
    let transform = Matrix4::new_translation(&Vector3::new(0.0, 0.0, config.elevation - slab_thickness));

    extrude_profile(&slab_profile, slab_thickness, Some(transform)).ok()
}

/// Calculate the overall building bounds from all floor plans
fn calculate_building_bounds(
    floor_plans: &[DetectedFloorPlan],
    storey_configs: &[StoreyConfig],
) -> BuildingBounds {
    let mut min_x = f64::MAX;
    let mut min_y = f64::MAX;
    let mut max_x = f64::MIN;
    let mut max_y = f64::MIN;

    for config in storey_configs {
        if let Some(floor_plan) = floor_plans.get(config.floor_plan_index) {
            for wall in &floor_plan.walls {
                for point in &wall.centerline {
                    let x = point.x * floor_plan.scale;
                    let y = point.y * floor_plan.scale;
                    min_x = min_x.min(x);
                    min_y = min_y.min(y);
                    max_x = max_x.max(x);
                    max_y = max_y.max(y);
                }
            }
        }
    }

    BuildingBounds {
        min_x: if min_x == f64::MAX { 0.0 } else { min_x },
        min_y: if min_y == f64::MAX { 0.0 } else { min_y },
        max_x: if max_x == f64::MIN { 10.0 } else { max_x },
        max_y: if max_y == f64::MIN { 10.0 } else { max_y },
    }
}

/// Errors that can occur during building generation
#[derive(Debug, Clone)]
pub enum BuildingError {
    EmptyInput,
    InvalidFloorPlanIndex(usize),
    ExtrusionError(String),
}

impl std::fmt::Display for BuildingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BuildingError::EmptyInput => write!(f, "Empty floor plans or storey configs"),
            BuildingError::InvalidFloorPlanIndex(idx) => {
                write!(f, "Invalid floor plan index: {}", idx)
            }
            BuildingError::ExtrusionError(msg) => write!(f, "Extrusion error: {}", msg),
        }
    }
}

impl std::error::Error for BuildingError {}

/// Generate a simple test building for validation
pub fn generate_test_building() -> GeneratedBuilding {
    // Create a simple floor plan with a few walls
    let walls = vec![
        // Outer walls (10m x 8m rectangle)
        DetectedWall {
            centerline: vec![Point2D::new(0.0, 0.0), Point2D::new(100.0, 0.0)],
            thickness: 3.0,
            wall_type: crate::types::WallType::Exterior,
            confidence: 1.0,
        },
        DetectedWall {
            centerline: vec![Point2D::new(100.0, 0.0), Point2D::new(100.0, 80.0)],
            thickness: 3.0,
            wall_type: crate::types::WallType::Exterior,
            confidence: 1.0,
        },
        DetectedWall {
            centerline: vec![Point2D::new(100.0, 80.0), Point2D::new(0.0, 80.0)],
            thickness: 3.0,
            wall_type: crate::types::WallType::Exterior,
            confidence: 1.0,
        },
        DetectedWall {
            centerline: vec![Point2D::new(0.0, 80.0), Point2D::new(0.0, 0.0)],
            thickness: 3.0,
            wall_type: crate::types::WallType::Exterior,
            confidence: 1.0,
        },
        // Interior wall
        DetectedWall {
            centerline: vec![Point2D::new(50.0, 0.0), Point2D::new(50.0, 80.0)],
            thickness: 1.5,
            wall_type: crate::types::WallType::Interior,
            confidence: 1.0,
        },
    ];

    let floor_plan = DetectedFloorPlan {
        page_index: 0,
        walls,
        openings: vec![],
        rooms: vec![],
        scale: 0.1, // 10 pixels = 1 meter
        image_width: 100,
        image_height: 80,
    };

    let storey_configs = vec![
        StoreyConfig {
            id: "ground".to_string(),
            label: "Ground Floor".to_string(),
            height: 3.0,
            elevation: 0.0,
            order: 0,
            floor_plan_index: 0,
        },
        StoreyConfig {
            id: "first".to_string(),
            label: "First Floor".to_string(),
            height: 3.0,
            elevation: 3.0,
            order: 1,
            floor_plan_index: 0,
        },
    ];

    generate_building(&[floor_plan], &storey_configs).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wall_to_profile() {
        let wall = DetectedWall {
            centerline: vec![Point2D::new(0.0, 0.0), Point2D::new(100.0, 0.0)],
            thickness: 20.0,
            wall_type: crate::types::WallType::Exterior,
            confidence: 1.0,
        };

        let profile = wall_to_profile(&wall, 0.1);

        assert_eq!(profile.outer.len(), 4);
        // Wall should be 10m long (100 * 0.1) and 2m thick (20 * 0.1)
    }

    #[test]
    fn test_generate_test_building() {
        let building = generate_test_building();

        assert_eq!(building.storeys.len(), 2);
        assert!((building.total_height - 6.0).abs() < 0.001);

        // Check that meshes have data
        for storey in &building.storeys {
            assert!(!storey.positions.is_empty());
            assert!(!storey.normals.is_empty());
            assert!(!storey.indices.is_empty());
        }
    }

    #[test]
    fn test_building_bounds() {
        let building = generate_test_building();

        assert!(building.bounds.min_x < building.bounds.max_x);
        assert!(building.bounds.min_y < building.bounds.max_y);
    }
}
