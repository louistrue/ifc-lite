// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! WebAssembly bindings for floor plan recognition and 3D building generation

use ifc_lite_pdf_vision::{
    detect_floor_plan_from_rgba, generate_building, generate_test_building,
    DetectedFloorPlan, DetectionConfig, GeneratedBuilding, StoreyConfig,
};
use wasm_bindgen::prelude::*;

/// Floor plan detection and 3D building generation API
#[wasm_bindgen]
pub struct FloorPlanAPI {
    config: DetectionConfig,
    floor_plans: Vec<DetectedFloorPlan>,
}

#[wasm_bindgen]
impl FloorPlanAPI {
    /// Create a new FloorPlanAPI instance with default configuration
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            config: DetectionConfig::default(),
            floor_plans: Vec::new(),
        }
    }

    /// Set detection configuration from JSON
    #[wasm_bindgen(js_name = setConfig)]
    pub fn set_config(&mut self, config_json: &str) -> Result<(), JsError> {
        let config: DetectionConfig = serde_json::from_str(config_json)
            .map_err(|e| JsError::new(&format!("Invalid config JSON: {}", e)))?;
        self.config = config;
        Ok(())
    }

    /// Get current configuration as JSON
    #[wasm_bindgen(js_name = getConfig)]
    pub fn get_config(&self) -> String {
        serde_json::to_string(&self.config).unwrap_or_else(|_| "{}".to_string())
    }

    /// Process an RGBA image and detect floor plan elements
    ///
    /// # Arguments
    ///
    /// * `rgba_data` - RGBA pixel data (4 bytes per pixel)
    /// * `width` - Image width in pixels
    /// * `height` - Image height in pixels
    /// * `page_index` - Page index for multi-page PDFs
    ///
    /// # Returns
    ///
    /// JSON string containing DetectedFloorPlan
    #[wasm_bindgen(js_name = detectFloorPlan)]
    pub fn detect_floor_plan(
        &mut self,
        rgba_data: &[u8],
        width: u32,
        height: u32,
        page_index: usize,
    ) -> Result<String, JsError> {
        let expected_len = (width * height * 4) as usize;
        if rgba_data.len() != expected_len {
            return Err(JsError::new(&format!(
                "Invalid RGBA data length: expected {}, got {}",
                expected_len,
                rgba_data.len()
            )));
        }

        let mut floor_plan = detect_floor_plan_from_rgba(rgba_data, width, height, &self.config);
        floor_plan.page_index = page_index;

        // Store for later building generation
        while self.floor_plans.len() <= page_index {
            self.floor_plans.push(DetectedFloorPlan::new(0, 0, self.floor_plans.len()));
        }
        self.floor_plans[page_index] = floor_plan.clone();

        serde_json::to_string(&floor_plan)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    /// Get detected floor plan as JSON
    #[wasm_bindgen(js_name = getFloorPlan)]
    pub fn get_floor_plan(&self, page_index: usize) -> Result<String, JsError> {
        let floor_plan = self
            .floor_plans
            .get(page_index)
            .ok_or_else(|| JsError::new(&format!("No floor plan at index {}", page_index)))?;

        serde_json::to_string(floor_plan)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    /// Get number of detected floor plans
    #[wasm_bindgen(js_name = getFloorPlanCount)]
    pub fn get_floor_plan_count(&self) -> usize {
        self.floor_plans.len()
    }

    /// Clear all detected floor plans
    #[wasm_bindgen]
    pub fn clear(&mut self) {
        self.floor_plans.clear();
    }

    /// Generate 3D building from detected floor plans
    ///
    /// # Arguments
    ///
    /// * `storey_configs_json` - JSON array of StoreyConfig objects
    ///
    /// # Returns
    ///
    /// JSON string containing GeneratedBuilding with mesh data
    #[wasm_bindgen(js_name = generateBuilding)]
    pub fn generate_building(&self, storey_configs_json: &str) -> Result<String, JsError> {
        if self.floor_plans.is_empty() {
            return Err(JsError::new("No floor plans detected. Call detectFloorPlan first."));
        }

        let storey_configs: Vec<StoreyConfig> = serde_json::from_str(storey_configs_json)
            .map_err(|e| JsError::new(&format!("Invalid storey config JSON: {}", e)))?;

        if storey_configs.is_empty() {
            return Err(JsError::new("Storey configs cannot be empty"));
        }

        let building = generate_building(&self.floor_plans, &storey_configs)
            .map_err(|e| JsError::new(&format!("Building generation error: {}", e)))?;

        serde_json::to_string(&building)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    /// Generate a test building for validation
    ///
    /// Creates a simple two-storey building without requiring image input.
    #[wasm_bindgen(js_name = generateTestBuilding)]
    pub fn generate_test_building(&self) -> Result<String, JsError> {
        let building = generate_test_building();

        serde_json::to_string(&building)
            .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
    }

    /// Set scale factor for floor plan (meters per pixel)
    #[wasm_bindgen(js_name = setScale)]
    pub fn set_scale(&mut self, page_index: usize, scale: f64) -> Result<(), JsError> {
        let floor_plan = self
            .floor_plans
            .get_mut(page_index)
            .ok_or_else(|| JsError::new(&format!("No floor plan at index {}", page_index)))?;

        floor_plan.scale = scale;
        Ok(())
    }

    /// Get mesh data for a specific storey as typed arrays
    ///
    /// Returns positions, normals, and indices as separate arrays for direct GPU upload.
    #[wasm_bindgen(js_name = getStoreyMeshData)]
    pub fn get_storey_mesh_data(
        &self,
        building_json: &str,
        storey_index: usize,
    ) -> Result<JsValue, JsError> {
        let building: GeneratedBuilding = serde_json::from_str(building_json)
            .map_err(|e| JsError::new(&format!("Invalid building JSON: {}", e)))?;

        let storey = building
            .storeys
            .get(storey_index)
            .ok_or_else(|| JsError::new(&format!("No storey at index {}", storey_index)))?;

        // Create JS object with typed arrays
        let obj = js_sys::Object::new();

        // Helper to convert JsValue error to JsError
        let set_prop = |key: &str, value: &JsValue| -> Result<(), JsError> {
            js_sys::Reflect::set(&obj, &key.into(), value)
                .map_err(|_| JsError::new(&format!("Failed to set property: {}", key)))?;
            Ok(())
        };

        // Positions
        let positions = js_sys::Float32Array::new_with_length(storey.positions.len() as u32);
        positions.copy_from(&storey.positions);
        set_prop("positions", &positions)?;

        // Normals
        let normals = js_sys::Float32Array::new_with_length(storey.normals.len() as u32);
        normals.copy_from(&storey.normals);
        set_prop("normals", &normals)?;

        // Indices
        let indices = js_sys::Uint32Array::new_with_length(storey.indices.len() as u32);
        indices.copy_from(&storey.indices);
        set_prop("indices", &indices)?;

        // Metadata
        set_prop("wallCount", &JsValue::from(storey.wall_count as u32))?;
        set_prop("label", &JsValue::from_str(&storey.config.label))?;
        set_prop("elevation", &JsValue::from(storey.config.elevation))?;
        set_prop("height", &JsValue::from(storey.config.height))?;

        Ok(obj.into())
    }
}

impl Default for FloorPlanAPI {
    fn default() -> Self {
        Self::new()
    }
}

/// Create a default storey configuration JSON for a single floor
#[wasm_bindgen(js_name = createDefaultStoreyConfig)]
pub fn create_default_storey_config(floor_plan_index: usize, label: &str, height: f64) -> String {
    let config = StoreyConfig {
        id: format!("storey_{}", floor_plan_index),
        label: label.to_string(),
        height,
        elevation: 0.0,
        order: floor_plan_index as u32,
        floor_plan_index,
    };

    serde_json::to_string(&[config]).unwrap_or_else(|_| "[]".to_string())
}

/// Create storey configurations for multiple floors
#[wasm_bindgen(js_name = createMultiStoreyConfig)]
pub fn create_multi_storey_config(
    floor_plan_indices_json: &str,
    labels_json: &str,
    heights_json: &str,
) -> Result<String, JsError> {
    let indices: Vec<usize> = serde_json::from_str(floor_plan_indices_json)
        .map_err(|e| JsError::new(&format!("Invalid indices JSON: {}", e)))?;

    let labels: Vec<String> = serde_json::from_str(labels_json)
        .map_err(|e| JsError::new(&format!("Invalid labels JSON: {}", e)))?;

    let heights: Vec<f64> = serde_json::from_str(heights_json)
        .map_err(|e| JsError::new(&format!("Invalid heights JSON: {}", e)))?;

    if indices.len() != labels.len() || indices.len() != heights.len() {
        return Err(JsError::new("Arrays must have the same length"));
    }

    let mut elevation = 0.0;
    let mut configs: Vec<StoreyConfig> = Vec::with_capacity(indices.len());

    for (order, ((floor_plan_index, label), height)) in indices
        .iter()
        .zip(labels.iter())
        .zip(heights.iter())
        .enumerate()
    {
        configs.push(StoreyConfig {
            id: format!("storey_{}", order),
            label: label.clone(),
            height: *height,
            elevation,
            order: order as u32,
            floor_plan_index: *floor_plan_index,
        });
        elevation += height;
    }

    serde_json::to_string(&configs)
        .map_err(|e| JsError::new(&format!("Serialization error: {}", e)))
}
