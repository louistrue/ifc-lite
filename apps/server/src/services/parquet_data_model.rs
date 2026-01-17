// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Parquet serialization for IFC data model (entities, properties, relationships, spatial hierarchy).

use crate::services::data_model::{DataModel, EntityMetadata, PropertySet, Relationship, SpatialHierarchyData, SpatialNode};
use arrow::array::{BooleanArray, ListArray, StringArray, UInt16Array, UInt32Array};
use arrow::array::builder::ListBuilder;
use arrow::array::UInt32Builder;
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use std::io::Cursor;
use std::sync::Arc;
use thiserror::Error;

/// Errors during data model Parquet serialization.
#[derive(Debug, Error)]
pub enum DataModelParquetError {
    #[error("Arrow error: {0}")]
    Arrow(#[from] arrow::error::ArrowError),
    #[error("Parquet error: {0}")]
    Parquet(#[from] parquet::errors::ParquetError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Serialize data model to Parquet format.
///
/// Creates 4 Parquet tables:
/// 1. Entities (entity_id, type_name, global_id, name, has_geometry)
/// 2. Properties (pset_id, pset_name, property_name, property_value, property_type)
/// 3. Relationships (rel_type, relating_id, related_id)
/// 4. Spatial (entity_id, parent_id, level, path, type_name, name, elevation, children_ids, element_ids)
///    Plus lookup tables: element_to_storey, element_to_building, element_to_site, element_to_space
pub fn serialize_data_model_to_parquet(data_model: &DataModel) -> Result<Vec<u8>, DataModelParquetError> {
    let mut result = Vec::new();

    // Serialize each table
    let entities_data = serialize_entities_table(&data_model.entities)?;
    let properties_data = serialize_properties_table(&data_model.property_sets)?;
    let relationships_data = serialize_relationships_table(&data_model.relationships)?;
    let spatial_data = serialize_spatial_hierarchy(&data_model.spatial_hierarchy)?;

    // Write format: [entities_len][entities_data][properties_len][properties_data][relationships_len][relationships_data][spatial_len][spatial_data]
    result.extend_from_slice(&(entities_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&entities_data);
    result.extend_from_slice(&(properties_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&properties_data);
    result.extend_from_slice(&(relationships_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&relationships_data);
    result.extend_from_slice(&(spatial_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&spatial_data);

    Ok(result)
}

/// Serialize entities table.
fn serialize_entities_table(entities: &[EntityMetadata]) -> Result<Vec<u8>, DataModelParquetError> {
    let count = entities.len();
    let mut entity_ids = Vec::with_capacity(count);
    let mut type_names = Vec::with_capacity(count);
    let mut global_ids = Vec::with_capacity(count);
    let mut names = Vec::with_capacity(count);
    let mut has_geometry = Vec::with_capacity(count);

    for entity in entities {
        entity_ids.push(entity.entity_id);
        type_names.push(entity.type_name.as_str());
        global_ids.push(entity.global_id.as_deref().unwrap_or(""));
        names.push(entity.name.as_deref().unwrap_or(""));
        has_geometry.push(entity.has_geometry);
    }

    let schema = Schema::new(vec![
        Field::new("entity_id", DataType::UInt32, false),
        Field::new("type_name", DataType::Utf8, false),
        Field::new("global_id", DataType::Utf8, true),
        Field::new("name", DataType::Utf8, true),
        Field::new("has_geometry", DataType::Boolean, false),
    ]);

    let batch = RecordBatch::try_new(
        Arc::new(schema),
        vec![
            Arc::new(UInt32Array::from(entity_ids)),
            Arc::new(StringArray::from(type_names)),
            Arc::new(StringArray::from(global_ids)),
            Arc::new(StringArray::from(names)),
            Arc::new(BooleanArray::from(has_geometry)),
        ],
    )?;

    write_parquet_batch(batch)
}

/// Serialize properties table.
fn serialize_properties_table(property_sets: &[PropertySet]) -> Result<Vec<u8>, DataModelParquetError> {
    // Flatten property sets into rows
    let mut pset_ids = Vec::new();
    let mut pset_names = Vec::new();
    let mut property_names = Vec::new();
    let mut property_values = Vec::new();
    let mut property_types = Vec::new();

    for pset in property_sets {
        for prop in &pset.properties {
            pset_ids.push(pset.pset_id);
            pset_names.push(pset.pset_name.as_str());
            property_names.push(prop.property_name.as_str());
            property_values.push(prop.property_value.as_str());
            property_types.push(prop.property_type.as_str());
        }
    }

    let schema = Schema::new(vec![
        Field::new("pset_id", DataType::UInt32, false),
        Field::new("pset_name", DataType::Utf8, false),
        Field::new("property_name", DataType::Utf8, false),
        Field::new("property_value", DataType::Utf8, false),
        Field::new("property_type", DataType::Utf8, false),
    ]);

    let batch = RecordBatch::try_new(
        Arc::new(schema),
        vec![
            Arc::new(UInt32Array::from(pset_ids)),
            Arc::new(StringArray::from(pset_names)),
            Arc::new(StringArray::from(property_names)),
            Arc::new(StringArray::from(property_values)),
            Arc::new(StringArray::from(property_types)),
        ],
    )?;

    write_parquet_batch(batch)
}

/// Serialize relationships table.
fn serialize_relationships_table(relationships: &[Relationship]) -> Result<Vec<u8>, DataModelParquetError> {
    let count = relationships.len();
    let mut rel_types = Vec::with_capacity(count);
    let mut relating_ids = Vec::with_capacity(count);
    let mut related_ids = Vec::with_capacity(count);

    for rel in relationships {
        rel_types.push(rel.rel_type.as_str());
        relating_ids.push(rel.relating_id);
        related_ids.push(rel.related_id);
    }

    let schema = Schema::new(vec![
        Field::new("rel_type", DataType::Utf8, false),
        Field::new("relating_id", DataType::UInt32, false),
        Field::new("related_id", DataType::UInt32, false),
    ]);

    let batch = RecordBatch::try_new(
        Arc::new(schema),
        vec![
            Arc::new(StringArray::from(rel_types)),
            Arc::new(UInt32Array::from(relating_ids)),
            Arc::new(UInt32Array::from(related_ids)),
        ],
    )?;

    write_parquet_batch(batch)
}

/// Serialize spatial hierarchy with nodes and lookup tables.
/// Returns combined binary: [nodes_len][nodes_data][element_to_storey_len][element_to_storey_data]...
fn serialize_spatial_hierarchy(hierarchy: &SpatialHierarchyData) -> Result<Vec<u8>, DataModelParquetError> {
    let mut result = Vec::new();

    // Serialize nodes table
    let nodes_data = serialize_spatial_nodes_table(&hierarchy.nodes)?;
    result.extend_from_slice(&(nodes_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&nodes_data);

    // Serialize lookup tables
    let element_to_storey_data = serialize_lookup_table(&hierarchy.element_to_storey, "element_to_storey")?;
    result.extend_from_slice(&(element_to_storey_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&element_to_storey_data);

    let element_to_building_data = serialize_lookup_table(&hierarchy.element_to_building, "element_to_building")?;
    result.extend_from_slice(&(element_to_building_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&element_to_building_data);

    let element_to_site_data = serialize_lookup_table(&hierarchy.element_to_site, "element_to_site")?;
    result.extend_from_slice(&(element_to_site_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&element_to_site_data);

    let element_to_space_data = serialize_lookup_table(&hierarchy.element_to_space, "element_to_space")?;
    result.extend_from_slice(&(element_to_space_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&element_to_space_data);

    // Add project_id as final u32
    result.extend_from_slice(&hierarchy.project_id.to_le_bytes());

    Ok(result)
}

/// Serialize spatial nodes table with all fields.
fn serialize_spatial_nodes_table(spatial_nodes: &[SpatialNode]) -> Result<Vec<u8>, DataModelParquetError> {
    use arrow::array::{Float64Array, ListArray};
    
    let count = spatial_nodes.len();
    let mut entity_ids = Vec::with_capacity(count);
    let mut parent_ids: Vec<Option<u32>> = Vec::with_capacity(count);
    let mut levels = Vec::with_capacity(count);
    let mut paths = Vec::with_capacity(count);
    let mut type_names = Vec::with_capacity(count);
    let mut names: Vec<Option<&str>> = Vec::with_capacity(count);
    let mut elevations: Vec<Option<f64>> = Vec::with_capacity(count);
    let mut children_ids_list = Vec::with_capacity(count);
    let mut element_ids_list = Vec::with_capacity(count);

    for node in spatial_nodes {
        entity_ids.push(node.entity_id);
        parent_ids.push(if node.parent_id == 0 { None } else { Some(node.parent_id) });
        levels.push(node.level);
        paths.push(node.path.as_str());
        type_names.push(node.type_name.as_str());
        names.push(node.name.as_deref());
        elevations.push(node.elevation);
        children_ids_list.push(node.children_ids.clone());
        element_ids_list.push(node.element_ids.clone());
    }
    

    // Build list arrays for children_ids and element_ids
    // Flatten all values and build offset array
    let mut children_values = Vec::new();
    let mut children_offsets = vec![0i32];
    let mut element_values = Vec::new();
    let mut element_offsets = vec![0i32];
    
    for children_ids in &children_ids_list {
        children_values.extend_from_slice(children_ids);
        children_offsets.push(children_values.len() as i32);
    }
    
    for element_ids in &element_ids_list {
        element_values.extend_from_slice(element_ids);
        element_offsets.push(element_values.len() as i32);
    }
    
    // Build ListArray using builder pattern
    let mut children_builder = ListBuilder::new(UInt32Builder::with_capacity(children_values.len()));
    for children_ids in &children_ids_list {
        children_builder.values().append_slice(children_ids);
        children_builder.append(true);
    }
    let children_list_array = children_builder.finish();
    
    let mut element_builder = ListBuilder::new(UInt32Builder::with_capacity(element_values.len()));
    for element_ids in &element_ids_list {
        element_builder.values().append_slice(element_ids);
        element_builder.append(true);
    }
    let element_list_array = element_builder.finish();

    // Schema must match what ListBuilder produces - inner items are nullable by default
    let schema = Schema::new(vec![
        Field::new("entity_id", DataType::UInt32, false),
        Field::new("parent_id", DataType::UInt32, true), // Nullable
        Field::new("level", DataType::UInt16, false),
        Field::new("path", DataType::Utf8, false),
        Field::new("type_name", DataType::Utf8, false),
        Field::new("name", DataType::Utf8, true), // Nullable
        Field::new("elevation", DataType::Float64, true), // Nullable
        Field::new("children_ids", DataType::new_list(DataType::UInt32, true), false), // Inner items nullable
        Field::new("element_ids", DataType::new_list(DataType::UInt32, true), false),  // Inner items nullable
    ]);

    let batch = RecordBatch::try_new(
        Arc::new(schema),
        vec![
            Arc::new(UInt32Array::from(entity_ids)),
            Arc::new(UInt32Array::from(parent_ids)),
            Arc::new(UInt16Array::from(levels)),
            Arc::new(StringArray::from(paths)),
            Arc::new(StringArray::from(type_names)),
            Arc::new(StringArray::from(names)),
            Arc::new(Float64Array::from(elevations)),
            Arc::new(children_list_array),
            Arc::new(element_list_array),
        ],
    )?;

    write_parquet_batch(batch)
}

/// Serialize a lookup table (element_id -> spatial_id pairs).
fn serialize_lookup_table(
    pairs: &[(u32, u32)],
    _table_name: &str,
) -> Result<Vec<u8>, DataModelParquetError> {
    let count = pairs.len();
    let mut element_ids = Vec::with_capacity(count);
    let mut spatial_ids = Vec::with_capacity(count);

    for (element_id, spatial_id) in pairs {
        element_ids.push(*element_id);
        spatial_ids.push(*spatial_id);
    }

    let schema = Schema::new(vec![
        Field::new("element_id", DataType::UInt32, false),
        Field::new("spatial_id", DataType::UInt32, false),
    ]);

    let batch = RecordBatch::try_new(
        Arc::new(schema),
        vec![
            Arc::new(UInt32Array::from(element_ids)),
            Arc::new(UInt32Array::from(spatial_ids)),
        ],
    )?;

    write_parquet_batch(batch)
}

/// Write a RecordBatch to a Parquet buffer with Zstd compression.
fn write_parquet_batch(batch: RecordBatch) -> Result<Vec<u8>, DataModelParquetError> {
    let mut buffer = Vec::new();
    let cursor = Cursor::new(&mut buffer);

    let props = WriterProperties::builder()
        .set_compression(Compression::ZSTD(Default::default()))
        .build();

    let mut writer = ArrowWriter::try_new(cursor, batch.schema(), Some(props))?;
    writer.write(&batch)?;
    writer.close()?;

    Ok(buffer)
}
