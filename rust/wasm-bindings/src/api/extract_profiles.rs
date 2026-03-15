// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! WASM API: extract_profiles — exposes raw profile polygons for 2D projection.

use super::IfcAPI;
use wasm_bindgen::prelude::*;

// ═══════════════════════════════════════════════════════════════════════════
// JS-FRIENDLY TYPES
// ═══════════════════════════════════════════════════════════════════════════

/// A single profile entry – raw 2D polygon + world transform.
///
/// Profile points are in **local 2D profile space** (metres).
/// Apply `transform` to `[x, y, 0, 1]` to get WebGL Y-up world coordinates.
#[wasm_bindgen]
pub struct ProfileEntryJs {
    express_id: u32,
    ifc_type: String,
    outer_points: Vec<f32>,
    hole_counts: Vec<u32>,
    hole_points: Vec<f32>,
    transform: [f32; 16],
    extrusion_dir: [f32; 3],
    extrusion_depth: f32,
    model_index: u32,
}

#[wasm_bindgen]
impl ProfileEntryJs {
    /// Express ID of the building element.
    #[wasm_bindgen(getter, js_name = expressId)]
    pub fn express_id(&self) -> u32 {
        self.express_id
    }

    /// IFC type name (e.g., `"IfcWall"`).
    #[wasm_bindgen(getter, js_name = ifcType)]
    pub fn ifc_type(&self) -> String {
        self.ifc_type.clone()
    }

    /// Outer boundary: flat `[x0, y0, x1, y1, …]` in local profile space (metres).
    #[wasm_bindgen(getter, js_name = outerPoints)]
    pub fn outer_points(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.outer_points[..])
    }

    /// Number of points per hole.
    #[wasm_bindgen(getter, js_name = holeCounts)]
    pub fn hole_counts(&self) -> js_sys::Uint32Array {
        js_sys::Uint32Array::from(&self.hole_counts[..])
    }

    /// All hole points concatenated: `[x0, y0, x1, y1, …]` (metres).
    #[wasm_bindgen(getter, js_name = holePoints)]
    pub fn hole_points(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.hole_points[..])
    }

    /// 4 × 4 column-major transform in WebGL Y-up world space.
    /// `M * [x, y, 0, 1]ᵀ` gives the world position.
    #[wasm_bindgen(getter)]
    pub fn transform(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.transform[..])
    }

    /// Extrusion direction `[dx, dy, dz]` in WebGL Y-up world space (unit vector).
    #[wasm_bindgen(getter, js_name = extrusionDir)]
    pub fn extrusion_dir(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.extrusion_dir[..])
    }

    /// Extrusion depth (metres).
    #[wasm_bindgen(getter, js_name = extrusionDepth)]
    pub fn extrusion_depth(&self) -> f32 {
        self.extrusion_depth
    }

    /// Model index for multi-model federation.
    #[wasm_bindgen(getter, js_name = modelIndex)]
    pub fn model_index(&self) -> u32 {
        self.model_index
    }
}

impl From<ifc_lite_geometry::ExtractedProfile> for ProfileEntryJs {
    fn from(p: ifc_lite_geometry::ExtractedProfile) -> Self {
        Self {
            express_id: p.express_id,
            ifc_type: p.ifc_type,
            outer_points: p.outer_points,
            hole_counts: p.hole_counts,
            hole_points: p.hole_points,
            transform: p.transform,
            extrusion_dir: p.extrusion_dir,
            extrusion_depth: p.extrusion_depth,
            model_index: p.model_index,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTION
// ═══════════════════════════════════════════════════════════════════════════

/// A collection of extracted profiles.
#[wasm_bindgen]
pub struct ProfileCollection {
    entries: Vec<ProfileEntryJs>,
}

#[wasm_bindgen]
impl ProfileCollection {
    /// Number of profiles.
    #[wasm_bindgen(getter)]
    pub fn length(&self) -> usize {
        self.entries.len()
    }

    /// Get profile at `index`.  Returns `undefined` for out-of-bounds index.
    pub fn get(&self, index: usize) -> Option<ProfileEntryJs> {
        self.entries.get(index).map(|e| ProfileEntryJs {
            express_id: e.express_id,
            ifc_type: e.ifc_type.clone(),
            outer_points: e.outer_points.clone(),
            hole_counts: e.hole_counts.clone(),
            hole_points: e.hole_points.clone(),
            transform: e.transform,
            extrusion_dir: e.extrusion_dir,
            extrusion_depth: e.extrusion_depth,
            model_index: e.model_index,
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// IfcAPI METHOD
// ═══════════════════════════════════════════════════════════════════════════

#[wasm_bindgen]
impl IfcAPI {
    /// Extract raw profile polygons from all building elements with `IfcExtrudedAreaSolid`
    /// representations.
    ///
    /// Returns a [`ProfileCollection`] whose entries each carry:
    /// - A 2D polygon (outer + holes) in local profile space (metres)
    /// - A 4 × 4 column-major transform in WebGL Y-up world space
    /// - Extrusion direction (world space) and depth (metres)
    ///
    /// Use [`ProfileProjector`] (TypeScript) to convert these into `DrawingLine[]`
    /// for clean projection without tessellation artifacts.
    ///
    /// ```javascript
    /// const api = new IfcAPI();
    /// const profiles = api.extractProfiles(ifcContent, 0);
    /// console.log('Profiles:', profiles.length);
    /// for (let i = 0; i < profiles.length; i++) {
    ///   const p = profiles.get(i);
    ///   console.log(p.ifcType, 'depth:', p.extrusionDepth);
    /// }
    /// ```
    #[wasm_bindgen(js_name = extractProfiles)]
    pub fn extract_profiles(&self, content: String, model_index: u32) -> ProfileCollection {
        let raw = ifc_lite_geometry::extract_profiles(&content, model_index);
        ProfileCollection {
            entries: raw.into_iter().map(ProfileEntryJs::from).collect(),
        }
    }
}
