// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Apache Superset REST API client for auto-dashboard generation.

use std::collections::HashMap;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::analytics::AnalyticsError;
use super::data_model::DataModel;

/// Detected model type based on entity distribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelType {
    Architectural,
    Structural,
    MEP,
}

/// Detect the model type from entity distribution.
///
/// Uses the presence/absence of key IFC types to classify:
/// - **MEP**: Has IfcFlowSegment or IfcDistributionElement
/// - **Structural**: Has beams & columns but no walls
/// - **Architectural**: Default (has walls or mixed)
pub fn detect_model_type(data_model: &DataModel) -> ModelType {
    let mut type_counts: HashMap<&str, usize> = HashMap::new();
    for entity in &data_model.entities {
        *type_counts.entry(entity.type_name.as_str()).or_default() += 1;
    }

    let has_walls = type_counts.contains_key("IfcWall")
        || type_counts.contains_key("IfcWallStandardCase");
    let has_beams = type_counts.contains_key("IfcBeam");
    let has_columns = type_counts.contains_key("IfcColumn");
    let has_mep = type_counts.contains_key("IfcFlowSegment")
        || type_counts.contains_key("IfcDistributionElement");

    if has_mep {
        ModelType::MEP
    } else if has_beams && has_columns && !has_walls {
        ModelType::Structural
    } else {
        ModelType::Architectural
    }
}

/// Superset REST API client.
pub struct SupersetClient {
    base_url: String,
    username: String,
    password: String,
    database_id: i32,
    access_token: Option<String>,
    http: reqwest::Client,
}

/// Configuration for creating a chart.
#[derive(Debug, Clone)]
pub struct ChartConfig {
    pub name: String,
    pub viz_type: String,
    pub dataset_id: i32,
    pub params: serde_json::Value,
}

/// Result of auto-creating Superset resources.
#[derive(Debug, Clone, Serialize)]
pub struct SupersetResources {
    pub dataset_id: i32,
    pub chart_ids: Vec<i32>,
    pub dashboard_id: i32,
    pub dashboard_url: String,
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct CreateResourceResponse {
    id: i32,
}

#[derive(Debug, Deserialize)]
struct CreateDatasetResponse {
    id: i32,
}

impl SupersetClient {
    /// Create a new Superset client.
    pub fn new(
        base_url: &str,
        username: &str,
        password: &str,
        database_id: i32,
    ) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            database_id,
            access_token: None,
            http: reqwest::Client::new(),
        }
    }

    /// Authenticate with Superset and obtain an access token.
    pub async fn login(&mut self) -> Result<(), AnalyticsError> {
        let resp = self
            .http
            .post(format!("{}/api/v1/security/login", self.base_url))
            .json(&serde_json::json!({
                "username": self.username,
                "password": self.password,
                "provider": "db",
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Login request failed: {e}")))?;

        if !resp.status().is_success() {
            return Err(AnalyticsError::Superset(format!(
                "Login failed with status {}",
                resp.status()
            )));
        }

        let body: LoginResponse = resp
            .json()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Login response parse failed: {e}")))?;

        self.access_token = Some(body.access_token);
        Ok(())
    }

    /// Build authorization headers.
    fn auth_headers(&self) -> Result<HeaderMap, AnalyticsError> {
        let token = self
            .access_token
            .as_ref()
            .ok_or_else(|| AnalyticsError::Superset("Not authenticated".into()))?;

        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", token))
                .map_err(|e| AnalyticsError::Superset(format!("Invalid token header: {e}")))?,
        );
        Ok(headers)
    }

    /// Create a virtual SQL dataset for a published model.
    pub async fn create_dataset(
        &self,
        model_id: &Uuid,
        model_name: &str,
    ) -> Result<i32, AnalyticsError> {
        let sql = format!(
            r#"
            SELECT
                e.express_id,
                e.ifc_type,
                e.global_id,
                e.name AS entity_name,
                e.has_geometry,
                sn.name AS storey_name,
                sn.elevation AS storey_elevation
            FROM bim_data.entities e
            LEFT JOIN bim_data.spatial_containment sc
                ON e.model_id = sc.model_id AND e.express_id = sc.element_id
            LEFT JOIN bim_data.spatial_nodes sn
                ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id
            WHERE e.model_id = '{}'
            "#,
            model_id
        );

        let table_name = format!("model_{}", model_id.to_string().replace('-', "_"));

        let resp = self
            .http
            .post(format!("{}/api/v1/dataset/", self.base_url))
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({
                "database": self.database_id,
                "schema": "bim_data",
                "table_name": table_name,
                "sql": sql,
                "owners": [1],
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Dataset creation failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AnalyticsError::Superset(format!(
                "Dataset creation returned {}: {}",
                status, body
            )));
        }

        let body: CreateDatasetResponse = resp
            .json()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Dataset response parse failed: {e}")))?;

        tracing::info!(
            dataset_id = body.id,
            table_name = %table_name,
            model_name = model_name,
            "Created Superset dataset"
        );

        Ok(body.id)
    }

    /// Create a chart in Superset.
    pub async fn create_chart(
        &self,
        chart_config: &ChartConfig,
    ) -> Result<i32, AnalyticsError> {
        let resp = self
            .http
            .post(format!("{}/api/v1/chart/", self.base_url))
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({
                "slice_name": chart_config.name,
                "viz_type": chart_config.viz_type,
                "datasource_id": chart_config.dataset_id,
                "datasource_type": "table",
                "params": serde_json::to_string(&chart_config.params)
                    .unwrap_or_else(|_| "{}".to_string()),
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Chart creation failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AnalyticsError::Superset(format!(
                "Chart creation returned {}: {}",
                status, body
            )));
        }

        let body: CreateResourceResponse = resp
            .json()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Chart response parse failed: {e}")))?;

        Ok(body.id)
    }

    /// Create a dashboard with the given charts laid out in a grid.
    pub async fn create_dashboard(
        &self,
        title: &str,
        chart_ids: &[i32],
        chart_names: &[&str],
    ) -> Result<i32, AnalyticsError> {
        // Build Superset position_json layout
        let position_json = build_dashboard_layout(chart_ids, chart_names);

        let resp = self
            .http
            .post(format!("{}/api/v1/dashboard/", self.base_url))
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({
                "dashboard_title": title,
                "position_json": serde_json::to_string(&position_json)
                    .unwrap_or_else(|_| "{}".to_string()),
                "json_metadata": serde_json::to_string(&serde_json::json!({
                    "cross_filters_enabled": true,
                })).unwrap_or_else(|_| "{}".to_string()),
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Dashboard creation failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AnalyticsError::Superset(format!(
                "Dashboard creation returned {}: {}",
                status, body
            )));
        }

        let body: CreateResourceResponse = resp
            .json()
            .await
            .map_err(|e| {
                AnalyticsError::Superset(format!("Dashboard response parse failed: {e}"))
            })?;

        tracing::info!(dashboard_id = body.id, title = title, "Created Superset dashboard");

        Ok(body.id)
    }

    /// Create a guest token for embedded dashboard access.
    pub async fn create_guest_token(
        &self,
        dashboard_id: i32,
    ) -> Result<String, AnalyticsError> {
        let resp = self
            .http
            .post(format!(
                "{}/api/v1/security/guest_token/",
                self.base_url
            ))
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({
                "user": {
                    "username": "guest",
                    "first_name": "Guest",
                    "last_name": "User",
                },
                "resources": [{
                    "type": "dashboard",
                    "id": dashboard_id.to_string(),
                }],
                "rls": [],
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Guest token request failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AnalyticsError::Superset(format!(
                "Guest token returned {}: {}",
                status, body
            )));
        }

        #[derive(Deserialize)]
        struct GuestTokenResponse {
            token: String,
        }

        let body: GuestTokenResponse = resp
            .json()
            .await
            .map_err(|e| {
                AnalyticsError::Superset(format!("Guest token response parse failed: {e}"))
            })?;

        Ok(body.token)
    }

    /// Create all Superset resources for a published model (dataset + charts + dashboard).
    ///
    /// Chart selection is driven by the detected `ModelType`:
    /// - **Architectural**: Element types, storey distribution, area takeoff, property browser
    /// - **Structural**: Element types, storey distribution, volume takeoff, property browser
    /// - **MEP**: Element types, storey distribution, system breakdown, property browser
    pub async fn create_all_resources(
        &mut self,
        model_id: &Uuid,
        model_name: &str,
        model_type: ModelType,
    ) -> Result<SupersetResources, AnalyticsError> {
        // Ensure authenticated
        if self.access_token.is_none() {
            self.login().await?;
        }

        // 1. Create entity summary dataset (for basic charts)
        let dataset_id = self.create_dataset(model_id, model_name).await?;

        // 2. Create quantity dataset (for takeoff charts) — separate virtual SQL
        let quantity_dataset_id = self
            .create_quantity_dataset(model_id, model_name)
            .await
            .ok(); // Non-fatal if quantities are empty

        // 3. Create property dataset (for property browser)
        let property_dataset_id = self
            .create_property_dataset(model_id, model_name)
            .await
            .ok(); // Non-fatal

        // 4. Create charts based on model type
        let chart_configs = chart_configs_for_model_type(
            dataset_id,
            quantity_dataset_id,
            property_dataset_id,
            model_name,
            model_type,
        );
        let mut chart_ids = Vec::with_capacity(chart_configs.len());

        for config in &chart_configs {
            let chart_id = self.create_chart(config).await?;
            chart_ids.push(chart_id);
        }

        // Collect names for layout
        let name_refs: Vec<&str> = chart_configs.iter().map(|c| c.name.as_str()).collect();

        // 5. Create dashboard
        let type_label = match model_type {
            ModelType::Architectural => "Architectural",
            ModelType::Structural => "Structural",
            ModelType::MEP => "MEP",
        };
        let dashboard_title = format!("BIM Dashboard ({type_label}): {model_name}");
        let dashboard_id = self
            .create_dashboard(&dashboard_title, &chart_ids, &name_refs)
            .await?;

        let dashboard_url = format!("{}/superset/dashboard/{}/", self.base_url, dashboard_id);

        Ok(SupersetResources {
            dataset_id,
            chart_ids,
            dashboard_id,
            dashboard_url,
        })
    }

    /// Create a virtual SQL dataset for quantity takeoffs.
    async fn create_quantity_dataset(
        &self,
        model_id: &Uuid,
        _model_name: &str,
    ) -> Result<i32, AnalyticsError> {
        let sql = format!(
            r#"
            SELECT
                e.ifc_type,
                sn.name AS storey_name,
                q.quantity_name,
                q.quantity_type,
                q.quantity_value
            FROM bim_data.quantities q
            JOIN bim_data.relationships r
                ON q.model_id = r.model_id AND q.qset_id = r.relating_id
            JOIN bim_data.entities e
                ON q.model_id = e.model_id AND r.related_id = e.express_id
            LEFT JOIN bim_data.spatial_containment sc
                ON e.model_id = sc.model_id AND e.express_id = sc.element_id
            LEFT JOIN bim_data.spatial_nodes sn
                ON e.model_id = sn.model_id AND sc.storey_id = sn.entity_id
            WHERE q.model_id = '{}' AND r.rel_type = 'IfcRelDefinesByProperties'
            "#,
            model_id
        );

        let table_name = format!("model_{}_quantities", model_id.to_string().replace('-', "_"));

        let resp = self
            .http
            .post(format!("{}/api/v1/dataset/", self.base_url))
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({
                "database": self.database_id,
                "schema": "bim_data",
                "table_name": table_name,
                "sql": sql,
                "owners": [1],
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Quantity dataset creation failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AnalyticsError::Superset(format!(
                "Quantity dataset creation returned {}: {}",
                status, body
            )));
        }

        let body: CreateDatasetResponse = resp
            .json()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Quantity dataset response parse failed: {e}")))?;

        Ok(body.id)
    }

    /// Create a virtual SQL dataset for the property browser.
    async fn create_property_dataset(
        &self,
        model_id: &Uuid,
        _model_name: &str,
    ) -> Result<i32, AnalyticsError> {
        let sql = format!(
            r#"
            SELECT
                e.express_id,
                e.ifc_type,
                e.name AS entity_name,
                p.pset_name,
                p.property_name,
                p.property_value
            FROM bim_data.entities e
            JOIN bim_data.relationships r
                ON e.model_id = r.model_id AND r.rel_type = 'IfcRelDefinesByProperties'
                AND r.related_id = e.express_id
            JOIN bim_data.properties p
                ON e.model_id = p.model_id AND r.relating_id = p.pset_id
            WHERE e.model_id = '{}'
            ORDER BY e.name, p.pset_name, p.property_name
            "#,
            model_id
        );

        let table_name = format!(
            "model_{}_properties",
            model_id.to_string().replace('-', "_")
        );

        let resp = self
            .http
            .post(format!("{}/api/v1/dataset/", self.base_url))
            .headers(self.auth_headers()?)
            .json(&serde_json::json!({
                "database": self.database_id,
                "schema": "bim_data",
                "table_name": table_name,
                "sql": sql,
                "owners": [1],
            }))
            .send()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Property dataset creation failed: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AnalyticsError::Superset(format!(
                "Property dataset creation returned {}: {}",
                status, body
            )));
        }

        let body: CreateDatasetResponse = resp
            .json()
            .await
            .map_err(|e| AnalyticsError::Superset(format!("Property dataset response parse failed: {e}")))?;

        Ok(body.id)
    }
}

/// Generate chart configurations based on model type.
///
/// All model types get: Element Type Breakdown (pie), Storey Distribution (bar), Entity Browser (table).
/// Additionally:
/// - **Architectural**: Area Takeoff table
/// - **Structural**: Volume Takeoff table
/// - **MEP**: System Breakdown pie
/// - All types: Property Browser table (if property dataset available)
fn chart_configs_for_model_type(
    entity_dataset_id: i32,
    quantity_dataset_id: Option<i32>,
    property_dataset_id: Option<i32>,
    model_name: &str,
    model_type: ModelType,
) -> Vec<ChartConfig> {
    let mut charts = vec![
        // 1. Element Type Breakdown (Pie) — all model types
        ChartConfig {
            name: format!("Element Types - {}", model_name),
            viz_type: "pie".to_string(),
            dataset_id: entity_dataset_id,
            params: serde_json::json!({
                "groupby": ["ifc_type"],
                "metric": {
                    "expressionType": "SIMPLE",
                    "column": {"column_name": "express_id"},
                    "aggregate": "COUNT",
                },
                "row_limit": 100,
            }),
        },
        // 2. Storey Distribution (Bar) — all model types
        ChartConfig {
            name: format!("Storey Distribution - {}", model_name),
            viz_type: "echarts_bar".to_string(),
            dataset_id: entity_dataset_id,
            params: serde_json::json!({
                "x_axis": "storey_name",
                "metrics": [{
                    "expressionType": "SIMPLE",
                    "column": {"column_name": "express_id"},
                    "aggregate": "COUNT",
                }],
                "row_limit": 100,
            }),
        },
        // 3. Entity Browser (Table) — all model types
        ChartConfig {
            name: format!("Entity Browser - {}", model_name),
            viz_type: "table".to_string(),
            dataset_id: entity_dataset_id,
            params: serde_json::json!({
                "all_columns": [
                    "express_id", "ifc_type", "entity_name",
                    "storey_name", "has_geometry"
                ],
                "row_limit": 1000,
                "page_length": 50,
            }),
        },
    ];

    // 4. Model-type-specific charts
    if let Some(qty_ds_id) = quantity_dataset_id {
        match model_type {
            ModelType::Architectural => {
                // Area Takeoff table
                charts.push(ChartConfig {
                    name: format!("Area Takeoff - {}", model_name),
                    viz_type: "table".to_string(),
                    dataset_id: qty_ds_id,
                    params: serde_json::json!({
                        "query_mode": "aggregate",
                        "groupby": ["ifc_type", "storey_name", "quantity_name"],
                        "metrics": [{
                            "expressionType": "SIMPLE",
                            "column": {"column_name": "quantity_value"},
                            "aggregate": "SUM",
                            "label": "Total Value",
                        }],
                        "adhoc_filters": [{
                            "expressionType": "SIMPLE",
                            "clause": "WHERE",
                            "subject": "quantity_type",
                            "operator": "==",
                            "comparator": "area",
                        }],
                        "row_limit": 1000,
                        "page_length": 50,
                    }),
                });
            }
            ModelType::Structural => {
                // Volume Takeoff table
                charts.push(ChartConfig {
                    name: format!("Volume Takeoff - {}", model_name),
                    viz_type: "table".to_string(),
                    dataset_id: qty_ds_id,
                    params: serde_json::json!({
                        "query_mode": "aggregate",
                        "groupby": ["ifc_type", "storey_name", "quantity_name"],
                        "metrics": [{
                            "expressionType": "SIMPLE",
                            "column": {"column_name": "quantity_value"},
                            "aggregate": "SUM",
                            "label": "Total Value",
                        }],
                        "adhoc_filters": [{
                            "expressionType": "SIMPLE",
                            "clause": "WHERE",
                            "subject": "quantity_type",
                            "operator": "==",
                            "comparator": "volume",
                        }],
                        "row_limit": 1000,
                        "page_length": 50,
                    }),
                });
            }
            ModelType::MEP => {
                // System Breakdown pie — counts flow elements by type
                charts.push(ChartConfig {
                    name: format!("System Breakdown - {}", model_name),
                    viz_type: "pie".to_string(),
                    dataset_id: entity_dataset_id,
                    params: serde_json::json!({
                        "groupby": ["ifc_type"],
                        "metric": {
                            "expressionType": "SIMPLE",
                            "column": {"column_name": "express_id"},
                            "aggregate": "COUNT",
                        },
                        "adhoc_filters": [{
                            "expressionType": "SQL",
                            "clause": "WHERE",
                            "sqlExpression": "ifc_type LIKE 'IfcFlow%' OR ifc_type LIKE 'IfcDistribution%'",
                        }],
                        "row_limit": 100,
                    }),
                });
            }
        }
    }

    // 5. Property Browser (Table) — all model types, if property dataset is available
    if let Some(prop_ds_id) = property_dataset_id {
        charts.push(ChartConfig {
            name: format!("Property Browser - {}", model_name),
            viz_type: "table".to_string(),
            dataset_id: prop_ds_id,
            params: serde_json::json!({
                "all_columns": [
                    "ifc_type", "entity_name", "pset_name",
                    "property_name", "property_value"
                ],
                "row_limit": 1000,
                "page_length": 50,
            }),
        });
    }

    charts
}

/// Build a Superset v2 dashboard layout JSON from chart IDs.
fn build_dashboard_layout(
    chart_ids: &[i32],
    chart_names: &[&str],
) -> serde_json::Value {
    let mut layout = serde_json::json!({
        "DASHBOARD_VERSION_KEY": "v2",
        "ROOT_ID": {
            "type": "ROOT",
            "id": "ROOT_ID",
            "children": ["GRID_ID"],
        },
        "GRID_ID": {
            "type": "GRID",
            "id": "GRID_ID",
            "children": [],
            "parents": ["ROOT_ID"],
        },
    });

    let mut row_children = Vec::new();

    for (i, (&chart_id, &chart_name)) in chart_ids.iter().zip(chart_names.iter()).enumerate() {
        let chart_key = format!("CHART-{}", i);
        let row_key = format!("ROW-{}", i);

        // Determine width based on position (first chart wider)
        let width = if i == 0 { 12 } else { 6 };
        let height = if i == 0 { 50 } else { 40 };

        layout[&chart_key] = serde_json::json!({
            "type": "CHART",
            "id": chart_key,
            "children": [],
            "parents": ["ROOT_ID", "GRID_ID", &row_key],
            "meta": {
                "width": width,
                "height": height,
                "chartId": chart_id,
                "sliceName": chart_name,
            },
        });

        layout[&row_key] = serde_json::json!({
            "type": "ROW",
            "id": row_key,
            "children": [&chart_key],
            "parents": ["ROOT_ID", "GRID_ID"],
            "meta": {
                "background": "BACKGROUND_TRANSPARENT",
            },
        });

        row_children.push(serde_json::Value::String(row_key));
    }

    layout["GRID_ID"]["children"] = serde_json::Value::Array(row_children);

    layout
}
