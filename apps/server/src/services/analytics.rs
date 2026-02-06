// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Analytics service — writes DataModel to PostgreSQL using bulk UNNEST inserts.

use sqlx::PgPool;
use uuid::Uuid;

use super::data_model::{DataModel, SpatialHierarchyData};
use crate::types::ModelMetadata;

/// Errors from the analytics pipeline.
#[derive(Debug, thiserror::Error)]
pub enum AnalyticsError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Data model not found in cache")]
    DataModelNotFound,

    #[error("Analytics not configured (DATABASE_URL not set)")]
    NotConfigured,

    #[error("Superset API error: {0}")]
    Superset(String),
}

/// Result of publishing a model to the analytics database.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PublishResult {
    pub model_id: Uuid,
    pub status: PublishStatus,
    pub superset_dataset_id: Option<i32>,
    pub superset_dashboard_id: Option<i32>,
    pub dashboard_url: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PublishStatus {
    Created,
    AlreadyExists,
}

/// Check if a model has already been published.
pub async fn check_published(
    pool: &PgPool,
    cache_key: &str,
) -> Result<Option<PublishResult>, AnalyticsError> {
    let row = sqlx::query_as::<_, (Uuid, Option<i32>, Option<i32>)>(
        r#"
        SELECT model_id, superset_dataset_id, superset_dashboard_id
        FROM bim_data.models
        WHERE cache_key = $1
        "#,
    )
    .bind(cache_key)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|(model_id, dataset_id, dashboard_id)| PublishResult {
        model_id,
        status: PublishStatus::AlreadyExists,
        superset_dataset_id: dataset_id,
        superset_dashboard_id: dashboard_id,
        dashboard_url: dashboard_id.map(|id| format!("/superset/dashboard/{}/", id)),
    }))
}

/// Publish a DataModel to PostgreSQL, returning the model UUID.
///
/// All inserts are wrapped in a single transaction for atomicity.
/// Uses UNNEST-based bulk inserts for performance.
pub async fn publish_model(
    pool: &PgPool,
    cache_key: &str,
    data_model: &DataModel,
    metadata: &ModelMetadata,
    file_name: Option<&str>,
) -> Result<Uuid, AnalyticsError> {
    let mut tx = pool.begin().await?;

    // 1. Create model record
    let model_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO bim_data.models
            (model_id, cache_key, file_name, schema_version, entity_count, geometry_count)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(model_id)
    .bind(cache_key)
    .bind(file_name)
    .bind(&metadata.schema_version)
    .bind(metadata.entity_count as i32)
    .bind(metadata.geometry_entity_count as i32)
    .execute(&mut *tx)
    .await?;

    // 2. Bulk insert entities
    insert_entities(&mut *tx, model_id, &data_model.entities).await?;

    // 3. Bulk insert properties (flattened from PropertySets)
    insert_properties(&mut *tx, model_id, &data_model.property_sets).await?;

    // 4. Bulk insert quantities (flattened from QuantitySets)
    insert_quantities(&mut *tx, model_id, &data_model.quantity_sets).await?;

    // 5. Bulk insert relationships
    insert_relationships(&mut *tx, model_id, &data_model.relationships).await?;

    // 6. Bulk insert spatial hierarchy
    insert_spatial_nodes(&mut *tx, model_id, &data_model.spatial_hierarchy).await?;
    insert_spatial_containment(&mut *tx, model_id, &data_model.spatial_hierarchy).await?;

    tx.commit().await?;

    tracing::info!(
        model_id = %model_id,
        cache_key = cache_key,
        entities = data_model.entities.len(),
        properties = data_model.property_sets.len(),
        quantities = data_model.quantity_sets.len(),
        relationships = data_model.relationships.len(),
        spatial_nodes = data_model.spatial_hierarchy.nodes.len(),
        "Published model to PostgreSQL"
    );

    Ok(model_id)
}

/// Update a model record with Superset resource IDs after dashboard creation.
pub async fn update_superset_ids(
    pool: &PgPool,
    model_id: Uuid,
    dataset_id: i32,
    dashboard_id: i32,
) -> Result<(), AnalyticsError> {
    sqlx::query(
        r#"
        UPDATE bim_data.models
        SET superset_dataset_id = $1, superset_dashboard_id = $2
        WHERE model_id = $3
        "#,
    )
    .bind(dataset_id)
    .bind(dashboard_id)
    .bind(model_id)
    .execute(pool)
    .await?;
    Ok(())
}

// ─── Bulk insert helpers using UNNEST ───────────────────────────────────────

const BATCH_SIZE: usize = 10_000;

async fn insert_entities(
    conn: &mut sqlx::PgConnection,
    model_id: Uuid,
    entities: &[super::data_model::EntityMetadata],
) -> Result<(), sqlx::Error> {
    if entities.is_empty() {
        return Ok(());
    }

    for chunk in entities.chunks(BATCH_SIZE) {
        let len = chunk.len();
        let mut express_ids = Vec::with_capacity(len);
        let mut ifc_types = Vec::with_capacity(len);
        let mut global_ids: Vec<Option<String>> = Vec::with_capacity(len);
        let mut names: Vec<Option<String>> = Vec::with_capacity(len);
        let mut has_geometry_flags = Vec::with_capacity(len);

        for entity in chunk {
            express_ids.push(entity.entity_id as i32);
            ifc_types.push(entity.type_name.clone());
            global_ids.push(entity.global_id.clone());
            names.push(entity.name.clone());
            has_geometry_flags.push(entity.has_geometry);
        }

        sqlx::query(
            r#"
            INSERT INTO bim_data.entities
                (model_id, express_id, ifc_type, global_id, name, has_geometry)
            SELECT $1, * FROM UNNEST(
                $2::INT[],
                $3::VARCHAR[],
                $4::VARCHAR[],
                $5::VARCHAR[],
                $6::BOOL[]
            )
            "#,
        )
        .bind(model_id)
        .bind(&express_ids)
        .bind(&ifc_types)
        .bind(&global_ids)
        .bind(&names)
        .bind(&has_geometry_flags)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn insert_properties(
    conn: &mut sqlx::PgConnection,
    model_id: Uuid,
    property_sets: &[super::data_model::PropertySet],
) -> Result<(), sqlx::Error> {
    // Flatten: each PropertySet has multiple Properties
    let total_props: usize = property_sets.iter().map(|ps| ps.properties.len()).sum();
    if total_props == 0 {
        return Ok(());
    }

    let mut pset_ids = Vec::with_capacity(total_props);
    let mut pset_names = Vec::with_capacity(total_props);
    let mut prop_names = Vec::with_capacity(total_props);
    let mut prop_types = Vec::with_capacity(total_props);
    let mut prop_values = Vec::with_capacity(total_props);

    for pset in property_sets {
        for prop in &pset.properties {
            pset_ids.push(pset.pset_id as i32);
            pset_names.push(pset.pset_name.clone());
            prop_names.push(prop.property_name.clone());
            prop_types.push(prop.property_type.clone());
            prop_values.push(prop.property_value.clone());
        }
    }

    for chunk_start in (0..total_props).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(total_props);

        sqlx::query(
            r#"
            INSERT INTO bim_data.properties
                (model_id, pset_id, pset_name, property_name, property_type, property_value)
            SELECT $1, * FROM UNNEST(
                $2::INT[],
                $3::VARCHAR[],
                $4::VARCHAR[],
                $5::VARCHAR[],
                $6::TEXT[]
            )
            "#,
        )
        .bind(model_id)
        .bind(&pset_ids[chunk_start..chunk_end])
        .bind(&pset_names[chunk_start..chunk_end])
        .bind(&prop_names[chunk_start..chunk_end])
        .bind(&prop_types[chunk_start..chunk_end])
        .bind(&prop_values[chunk_start..chunk_end])
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn insert_quantities(
    conn: &mut sqlx::PgConnection,
    model_id: Uuid,
    quantity_sets: &[super::data_model::QuantitySet],
) -> Result<(), sqlx::Error> {
    let total_quants: usize = quantity_sets.iter().map(|qs| qs.quantities.len()).sum();
    if total_quants == 0 {
        return Ok(());
    }

    let mut qset_ids = Vec::with_capacity(total_quants);
    let mut qset_names = Vec::with_capacity(total_quants);
    let mut quant_names = Vec::with_capacity(total_quants);
    let mut quant_types = Vec::with_capacity(total_quants);
    let mut quant_values = Vec::with_capacity(total_quants);

    for qset in quantity_sets {
        for quant in &qset.quantities {
            qset_ids.push(qset.qset_id as i32);
            qset_names.push(qset.qset_name.clone());
            quant_names.push(quant.quantity_name.clone());
            quant_types.push(quant.quantity_type.clone());
            quant_values.push(quant.quantity_value);
        }
    }

    for chunk_start in (0..total_quants).step_by(BATCH_SIZE) {
        let chunk_end = (chunk_start + BATCH_SIZE).min(total_quants);

        sqlx::query(
            r#"
            INSERT INTO bim_data.quantities
                (model_id, qset_id, qset_name, quantity_name, quantity_type, quantity_value)
            SELECT $1, * FROM UNNEST(
                $2::INT[],
                $3::VARCHAR[],
                $4::VARCHAR[],
                $5::VARCHAR[],
                $6::FLOAT8[]
            )
            "#,
        )
        .bind(model_id)
        .bind(&qset_ids[chunk_start..chunk_end])
        .bind(&qset_names[chunk_start..chunk_end])
        .bind(&quant_names[chunk_start..chunk_end])
        .bind(&quant_types[chunk_start..chunk_end])
        .bind(&quant_values[chunk_start..chunk_end])
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn insert_relationships(
    conn: &mut sqlx::PgConnection,
    model_id: Uuid,
    relationships: &[super::data_model::Relationship],
) -> Result<(), sqlx::Error> {
    if relationships.is_empty() {
        return Ok(());
    }

    for chunk in relationships.chunks(BATCH_SIZE) {
        let len = chunk.len();
        let mut rel_types = Vec::with_capacity(len);
        let mut relating_ids = Vec::with_capacity(len);
        let mut related_ids = Vec::with_capacity(len);

        for rel in chunk {
            rel_types.push(rel.rel_type.clone());
            relating_ids.push(rel.relating_id as i32);
            related_ids.push(rel.related_id as i32);
        }

        sqlx::query(
            r#"
            INSERT INTO bim_data.relationships
                (model_id, rel_type, relating_id, related_id)
            SELECT $1, * FROM UNNEST(
                $2::VARCHAR[],
                $3::INT[],
                $4::INT[]
            )
            "#,
        )
        .bind(model_id)
        .bind(&rel_types)
        .bind(&relating_ids)
        .bind(&related_ids)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn insert_spatial_nodes(
    conn: &mut sqlx::PgConnection,
    model_id: Uuid,
    hierarchy: &SpatialHierarchyData,
) -> Result<(), sqlx::Error> {
    if hierarchy.nodes.is_empty() {
        return Ok(());
    }

    for chunk in hierarchy.nodes.chunks(BATCH_SIZE) {
        let len = chunk.len();
        let mut entity_ids = Vec::with_capacity(len);
        let mut parent_ids: Vec<Option<i32>> = Vec::with_capacity(len);
        let mut levels = Vec::with_capacity(len);
        let mut paths = Vec::with_capacity(len);
        let mut type_names = Vec::with_capacity(len);
        let mut names: Vec<Option<String>> = Vec::with_capacity(len);
        let mut elevations: Vec<Option<f64>> = Vec::with_capacity(len);

        for node in chunk {
            entity_ids.push(node.entity_id as i32);
            parent_ids.push(if node.parent_id == 0 {
                None
            } else {
                Some(node.parent_id as i32)
            });
            levels.push(node.level as i16);
            paths.push(node.path.clone());
            type_names.push(node.type_name.clone());
            names.push(node.name.clone());
            elevations.push(node.elevation);
        }

        sqlx::query(
            r#"
            INSERT INTO bim_data.spatial_nodes
                (model_id, entity_id, parent_id, level, path, type_name, name, elevation)
            SELECT $1, * FROM UNNEST(
                $2::INT[],
                $3::INT[],
                $4::SMALLINT[],
                $5::TEXT[],
                $6::VARCHAR[],
                $7::VARCHAR[],
                $8::FLOAT8[]
            )
            "#,
        )
        .bind(model_id)
        .bind(&entity_ids)
        .bind(&parent_ids)
        .bind(&levels)
        .bind(&paths)
        .bind(&type_names)
        .bind(&names)
        .bind(&elevations)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}

async fn insert_spatial_containment(
    conn: &mut sqlx::PgConnection,
    model_id: Uuid,
    hierarchy: &SpatialHierarchyData,
) -> Result<(), sqlx::Error> {
    // Build a combined containment table from the various element_to_* maps
    use rustc_hash::FxHashMap;

    // Merge all containment maps into a single per-element record
    let mut containment: FxHashMap<u32, (Option<i32>, Option<i32>, Option<i32>, Option<i32>)> =
        FxHashMap::default();

    for &(element_id, storey_id) in &hierarchy.element_to_storey {
        containment
            .entry(element_id)
            .or_insert((None, None, None, None))
            .0 = Some(storey_id as i32);
    }
    for &(element_id, building_id) in &hierarchy.element_to_building {
        containment
            .entry(element_id)
            .or_insert((None, None, None, None))
            .1 = Some(building_id as i32);
    }
    for &(element_id, site_id) in &hierarchy.element_to_site {
        containment
            .entry(element_id)
            .or_insert((None, None, None, None))
            .2 = Some(site_id as i32);
    }
    for &(element_id, space_id) in &hierarchy.element_to_space {
        containment
            .entry(element_id)
            .or_insert((None, None, None, None))
            .3 = Some(space_id as i32);
    }

    if containment.is_empty() {
        return Ok(());
    }

    let entries: Vec<_> = containment.into_iter().collect();

    for chunk in entries.chunks(BATCH_SIZE) {
        let len = chunk.len();
        let mut element_ids = Vec::with_capacity(len);
        let mut storey_ids: Vec<Option<i32>> = Vec::with_capacity(len);
        let mut building_ids: Vec<Option<i32>> = Vec::with_capacity(len);
        let mut site_ids: Vec<Option<i32>> = Vec::with_capacity(len);
        let mut space_ids: Vec<Option<i32>> = Vec::with_capacity(len);

        for &(element_id, (storey_id, building_id, site_id, space_id)) in chunk {
            element_ids.push(element_id as i32);
            storey_ids.push(storey_id);
            building_ids.push(building_id);
            site_ids.push(site_id);
            space_ids.push(space_id);
        }

        sqlx::query(
            r#"
            INSERT INTO bim_data.spatial_containment
                (model_id, element_id, storey_id, building_id, site_id, space_id)
            SELECT $1, * FROM UNNEST(
                $2::INT[],
                $3::INT[],
                $4::INT[],
                $5::INT[],
                $6::INT[]
            )
            "#,
        )
        .bind(model_id)
        .bind(&element_ids)
        .bind(&storey_ids)
        .bind(&building_ids)
        .bind(&site_ids)
        .bind(&space_ids)
        .execute(&mut *conn)
        .await?;
    }

    Ok(())
}
