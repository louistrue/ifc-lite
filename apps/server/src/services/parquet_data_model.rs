// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Parquet serialization for IFC data model (entities, properties, relationships, spatial hierarchy).

use crate::services::data_model::{DataModel, EntityMetadata, PropertySet, QuantitySet, Relationship, SpatialHierarchyData, SpatialNode};
use arrow::array::{BooleanArray, ListArray, StringArray, UInt16Array, UInt32Array};
use arrow::array::builder::ListBuilder;
use arrow::array::UInt32Builder;
use arrow::datatypes::{DataType, Field, Schema};
use arrow::record_batch::RecordBatch;
use parquet::arrow::ArrowWriter;
use parquet::basic::Compression;
use parquet::file::properties::WriterProperties;
use rayon::prelude::*;
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
/// Creates 5 Parquet tables:
/// 1. Entities (entity_id, type_name, global_id, name, has_geometry)
/// 2. Properties (pset_id, pset_name, property_name, property_value, property_type)
/// 3. Quantities (qset_id, qset_name, method_of_measurement, quantity_name, quantity_value, quantity_type)
/// 4. Relationships (rel_type, relating_id, related_id)
/// 5. Spatial (entity_id, parent_id, level, path, type_name, name, elevation, children_ids, element_ids)
///    Plus lookup tables: element_to_storey, element_to_building, element_to_site, element_to_space
pub fn serialize_data_model_to_parquet(data_model: &DataModel) -> Result<Vec<u8>, DataModelParquetError> {
    // Serialize all tables in parallel using rayon
    let (entities_data, ((properties_data, quantities_data), (relationships_data, spatial_data))) = rayon::join(
        || serialize_entities_table(&data_model.entities),
        || rayon::join(
            || rayon::join(
                || serialize_properties_table(&data_model.property_sets),
                || serialize_quantities_table(&data_model.quantity_sets),
            ),
            || rayon::join(
                || serialize_relationships_table(&data_model.relationships),
                || serialize_spatial_hierarchy(&data_model.spatial_hierarchy),
            ),
        ),
    );

    let entities_data = entities_data?;
    let properties_data = properties_data?;
    let quantities_data = quantities_data?;
    let relationships_data = relationships_data?;
    let spatial_data = spatial_data?;

    // Write format: [entities_len][entities_data][properties_len][properties_data][quantities_len][quantities_data][relationships_len][relationships_data][spatial_len][spatial_data]
    let mut result = Vec::new();
    result.extend_from_slice(&(entities_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&entities_data);
    result.extend_from_slice(&(properties_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&properties_data);
    result.extend_from_slice(&(quantities_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&quantities_data);
    result.extend_from_slice(&(relationships_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&relationships_data);
    result.extend_from_slice(&(spatial_data.len() as u32).to_le_bytes());
    result.extend_from_slice(&spatial_data);

    Ok(result)
}

/// Serialize entities table.
fn serialize_entities_table(entities: &[EntityMetadata]) -> Result<Vec<u8>, DataModelParquetError> {
    let count = entities.len();
    
    // Build arrays in parallel using rayon
    let results: Vec<(u32, String, String, String, bool)> = entities
        .par_iter()
        .map(|entity| {
            (
                entity.entity_id,
                entity.type_name.clone(),
                entity.global_id.clone().unwrap_or_default(),
                entity.name.clone().unwrap_or_default(),
                entity.has_geometry,
            )
        })
        .collect();
    
    // Split into separate vectors
    let mut entity_ids = Vec::with_capacity(count);
    let mut type_names = Vec::with_capacity(count);
    let mut global_ids = Vec::with_capacity(count);
    let mut names = Vec::with_capacity(count);
    let mut has_geometry = Vec::with_capacity(count);
    
    for (id, type_name, global_id, name, has_geom) in results {
        entity_ids.push(id);
        type_names.push(type_name);
        global_ids.push(global_id);
        names.push(name);
        has_geometry.push(has_geom);
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
    // Flatten property sets into rows using parallel iteration
    let rows: Vec<(u32, String, String, String, String)> = property_sets
        .par_iter()
        .flat_map_iter(|pset| {
            pset.properties.iter().map(move |prop| {
                (
                    pset.pset_id,
                    pset.pset_name.clone(),
                    prop.property_name.clone(),
                    prop.property_value.clone(),
                    prop.property_type.clone(),
                )
            })
        })
        .collect();
    
    // Split into separate vectors
    let mut pset_ids = Vec::with_capacity(rows.len());
    let mut pset_names = Vec::with_capacity(rows.len());
    let mut property_names = Vec::with_capacity(rows.len());
    let mut property_values = Vec::with_capacity(rows.len());
    let mut property_types = Vec::with_capacity(rows.len());
    
    for (pset_id, pset_name, prop_name, prop_value, prop_type) in rows {
        pset_ids.push(pset_id);
        pset_names.push(pset_name);
        property_names.push(prop_name);
        property_values.push(prop_value);
        property_types.push(prop_type);
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

/// Serialize quantities table.
fn serialize_quantities_table(quantity_sets: &[QuantitySet]) -> Result<Vec<u8>, DataModelParquetError> {
    use arrow::array::Float64Array;

    // Flatten quantity sets into rows using parallel iteration
    let rows: Vec<(u32, String, String, String, f64, String)> = quantity_sets
        .par_iter()
        .flat_map_iter(|qset| {
            qset.quantities.iter().map(move |quant| {
                (
                    qset.qset_id,
                    qset.qset_name.clone(),
                    qset.method_of_measurement.clone().unwrap_or_default(),
                    quant.quantity_name.clone(),
                    quant.quantity_value,
                    quant.quantity_type.clone(),
                )
            })
        })
        .collect();

    // Split into separate vectors
    let mut qset_ids = Vec::with_capacity(rows.len());
    let mut qset_names = Vec::with_capacity(rows.len());
    let mut methods = Vec::with_capacity(rows.len());
    let mut quantity_names = Vec::with_capacity(rows.len());
    let mut quantity_values = Vec::with_capacity(rows.len());
    let mut quantity_types = Vec::with_capacity(rows.len());

    for (qset_id, qset_name, method, quant_name, quant_value, quant_type) in rows {
        qset_ids.push(qset_id);
        qset_names.push(qset_name);
        methods.push(method);
        quantity_names.push(quant_name);
        quantity_values.push(quant_value);
        quantity_types.push(quant_type);
    }

    let schema = Schema::new(vec![
        Field::new("qset_id", DataType::UInt32, false),
        Field::new("qset_name", DataType::Utf8, false),
        Field::new("method_of_measurement", DataType::Utf8, true),
        Field::new("quantity_name", DataType::Utf8, false),
        Field::new("quantity_value", DataType::Float64, false),
        Field::new("quantity_type", DataType::Utf8, false),
    ]);

    let batch = RecordBatch::try_new(
        Arc::new(schema),
        vec![
            Arc::new(UInt32Array::from(qset_ids)),
            Arc::new(StringArray::from(qset_names)),
            Arc::new(StringArray::from(methods)),
            Arc::new(StringArray::from(quantity_names)),
            Arc::new(Float64Array::from(quantity_values)),
            Arc::new(StringArray::from(quantity_types)),
        ],
    )?;

    write_parquet_batch(batch)
}

/// Serialize relationships table.
fn serialize_relationships_table(relationships: &[Relationship]) -> Result<Vec<u8>, DataModelParquetError> {
    let count = relationships.len();
    
    // Build arrays in parallel
    let results: Vec<(String, u32, u32)> = relationships
        .par_iter()
        .map(|rel| (rel.rel_type.clone(), rel.relating_id, rel.related_id))
        .collect();
    
    let mut rel_types = Vec::with_capacity(count);
    let mut relating_ids = Vec::with_capacity(count);
    let mut related_ids = Vec::with_capacity(count);
    
    for (rel_type, relating_id, related_id) in results {
        rel_types.push(rel_type);
        relating_ids.push(relating_id);
        related_ids.push(related_id);
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
        .set_compression(Compression::LZ4_RAW)
        .build();

    let mut writer = ArrowWriter::try_new(cursor, batch.schema(), Some(props))?;
    writer.write(&batch)?;
    writer.close()?;

    Ok(buffer)
}

// ─── Deserialization ────────────────────────────────────────────────────────

use arrow::array::{Array as ArrowArrayTrait, Float64Array};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

/// Deserialize a DataModel from cached Parquet bytes.
///
/// This is the inverse of `serialize_data_model_to_parquet`.
pub fn deserialize_data_model_from_parquet(data: &[u8]) -> Result<DataModel, DataModelParquetError> {
    let mut offset = 0;

    // Helper to read a length-prefixed Parquet table
    let read_section = |offset: &mut usize| -> Result<Vec<u8>, DataModelParquetError> {
        if *offset + 4 > data.len() {
            return Err(DataModelParquetError::Io(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "Unexpected end of data model buffer",
            )));
        }
        let len = u32::from_le_bytes(data[*offset..*offset + 4].try_into().unwrap()) as usize;
        *offset += 4;
        if *offset + len > data.len() {
            return Err(DataModelParquetError::Io(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                format!("Section length {} exceeds remaining data", len),
            )));
        }
        let section = data[*offset..*offset + len].to_vec();
        *offset += len;
        Ok(section)
    };

    let entities_data = read_section(&mut offset)?;
    let properties_data = read_section(&mut offset)?;
    let quantities_data = read_section(&mut offset)?;
    let relationships_data = read_section(&mut offset)?;
    let spatial_data = read_section(&mut offset)?;

    let entities = deserialize_entities(&entities_data)?;
    let property_sets = deserialize_properties(&properties_data)?;
    let quantity_sets = deserialize_quantities(&quantities_data)?;
    let relationships = deserialize_relationships(&relationships_data)?;
    let spatial_hierarchy = deserialize_spatial_hierarchy(&spatial_data)?;

    Ok(DataModel {
        entities,
        property_sets,
        quantity_sets,
        relationships,
        spatial_hierarchy,
    })
}

fn read_parquet_batch(data: &[u8]) -> Result<RecordBatch, DataModelParquetError> {
    let reader = ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(data.to_vec()))?
        .build()?;
    let batches: Vec<RecordBatch> = reader.collect::<Result<Vec<_>, _>>()?;
    if batches.is_empty() {
        return Err(DataModelParquetError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Empty Parquet table",
        )));
    }
    Ok(batches.into_iter().next().unwrap())
}

fn deserialize_entities(data: &[u8]) -> Result<Vec<EntityMetadata>, DataModelParquetError> {
    let batch = read_parquet_batch(data)?;
    let count = batch.num_rows();

    let entity_ids = batch.column(0).as_any().downcast_ref::<UInt32Array>().unwrap();
    let type_names = batch.column(1).as_any().downcast_ref::<StringArray>().unwrap();
    let global_ids = batch.column(2).as_any().downcast_ref::<StringArray>().unwrap();
    let names = batch.column(3).as_any().downcast_ref::<StringArray>().unwrap();
    let has_geometry = batch.column(4).as_any().downcast_ref::<BooleanArray>().unwrap();

    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        let gid = global_ids.value(i).to_string();
        let name = names.value(i).to_string();
        result.push(EntityMetadata {
            entity_id: entity_ids.value(i),
            type_name: type_names.value(i).to_string(),
            global_id: if gid.is_empty() { None } else { Some(gid) },
            name: if name.is_empty() { None } else { Some(name) },
            has_geometry: has_geometry.value(i),
        });
    }
    Ok(result)
}

fn deserialize_properties(data: &[u8]) -> Result<Vec<PropertySet>, DataModelParquetError> {
    let batch = read_parquet_batch(data)?;
    let count = batch.num_rows();

    let pset_ids = batch.column(0).as_any().downcast_ref::<UInt32Array>().unwrap();
    let pset_names = batch.column(1).as_any().downcast_ref::<StringArray>().unwrap();
    let property_names = batch.column(2).as_any().downcast_ref::<StringArray>().unwrap();
    let property_values = batch.column(3).as_any().downcast_ref::<StringArray>().unwrap();
    let property_types = batch.column(4).as_any().downcast_ref::<StringArray>().unwrap();

    // Group properties by pset_id
    use std::collections::BTreeMap;
    let mut pset_map: BTreeMap<u32, (String, Vec<super::data_model::Property>)> = BTreeMap::new();
    for i in 0..count {
        let pset_id = pset_ids.value(i);
        let entry = pset_map.entry(pset_id).or_insert_with(|| {
            (pset_names.value(i).to_string(), Vec::new())
        });
        entry.1.push(super::data_model::Property {
            property_name: property_names.value(i).to_string(),
            property_value: property_values.value(i).to_string(),
            property_type: property_types.value(i).to_string(),
        });
    }

    Ok(pset_map.into_iter().map(|(pset_id, (pset_name, properties))| {
        PropertySet { pset_id, pset_name, properties }
    }).collect())
}

fn deserialize_quantities(data: &[u8]) -> Result<Vec<QuantitySet>, DataModelParquetError> {
    let batch = read_parquet_batch(data)?;
    let count = batch.num_rows();

    let qset_ids = batch.column(0).as_any().downcast_ref::<UInt32Array>().unwrap();
    let qset_names = batch.column(1).as_any().downcast_ref::<StringArray>().unwrap();
    let methods = batch.column(2).as_any().downcast_ref::<StringArray>().unwrap();
    let quantity_names = batch.column(3).as_any().downcast_ref::<StringArray>().unwrap();
    let quantity_values = batch.column(4).as_any().downcast_ref::<Float64Array>().unwrap();
    let quantity_types = batch.column(5).as_any().downcast_ref::<StringArray>().unwrap();

    use std::collections::BTreeMap;
    let mut qset_map: BTreeMap<u32, (String, Option<String>, Vec<super::data_model::Quantity>)> = BTreeMap::new();
    for i in 0..count {
        let qset_id = qset_ids.value(i);
        let entry = qset_map.entry(qset_id).or_insert_with(|| {
            let method = methods.value(i).to_string();
            (
                qset_names.value(i).to_string(),
                if method.is_empty() { None } else { Some(method) },
                Vec::new(),
            )
        });
        entry.2.push(super::data_model::Quantity {
            quantity_name: quantity_names.value(i).to_string(),
            quantity_value: quantity_values.value(i),
            quantity_type: quantity_types.value(i).to_string(),
        });
    }

    Ok(qset_map.into_iter().map(|(qset_id, (qset_name, method, quantities))| {
        QuantitySet { qset_id, qset_name, method_of_measurement: method, quantities }
    }).collect())
}

fn deserialize_relationships(data: &[u8]) -> Result<Vec<Relationship>, DataModelParquetError> {
    let batch = read_parquet_batch(data)?;
    let count = batch.num_rows();

    let rel_types = batch.column(0).as_any().downcast_ref::<StringArray>().unwrap();
    let relating_ids = batch.column(1).as_any().downcast_ref::<UInt32Array>().unwrap();
    let related_ids = batch.column(2).as_any().downcast_ref::<UInt32Array>().unwrap();

    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        result.push(Relationship {
            rel_type: rel_types.value(i).to_string(),
            relating_id: relating_ids.value(i),
            related_id: related_ids.value(i),
        });
    }
    Ok(result)
}

fn deserialize_spatial_hierarchy(data: &[u8]) -> Result<SpatialHierarchyData, DataModelParquetError> {
    let mut offset = 0;
    let read_section = |offset: &mut usize| -> Result<Vec<u8>, DataModelParquetError> {
        if *offset + 4 > data.len() {
            return Err(DataModelParquetError::Io(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "Unexpected end of spatial hierarchy buffer",
            )));
        }
        let len = u32::from_le_bytes(data[*offset..*offset + 4].try_into().unwrap()) as usize;
        *offset += 4;
        let section = data[*offset..*offset + len].to_vec();
        *offset += len;
        Ok(section)
    };

    let nodes_data = read_section(&mut offset)?;
    let element_to_storey_data = read_section(&mut offset)?;
    let element_to_building_data = read_section(&mut offset)?;
    let element_to_site_data = read_section(&mut offset)?;
    let element_to_space_data = read_section(&mut offset)?;

    // Read project_id
    let project_id = if offset + 4 <= data.len() {
        u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
    } else {
        0
    };

    let nodes = deserialize_spatial_nodes(&nodes_data)?;
    let element_to_storey = deserialize_lookup_pairs(&element_to_storey_data)?;
    let element_to_building = deserialize_lookup_pairs(&element_to_building_data)?;
    let element_to_site = deserialize_lookup_pairs(&element_to_site_data)?;
    let element_to_space = deserialize_lookup_pairs(&element_to_space_data)?;

    Ok(SpatialHierarchyData {
        nodes,
        project_id,
        element_to_storey,
        element_to_building,
        element_to_site,
        element_to_space,
    })
}

fn deserialize_spatial_nodes(data: &[u8]) -> Result<Vec<SpatialNode>, DataModelParquetError> {
    let batch = read_parquet_batch(data)?;
    let count = batch.num_rows();

    let entity_ids = batch.column(0).as_any().downcast_ref::<UInt32Array>().unwrap();
    let parent_ids = batch.column(1).as_any().downcast_ref::<UInt32Array>().unwrap();
    let levels = batch.column(2).as_any().downcast_ref::<UInt16Array>().unwrap();
    let paths = batch.column(3).as_any().downcast_ref::<StringArray>().unwrap();
    let type_names = batch.column(4).as_any().downcast_ref::<StringArray>().unwrap();
    let names = batch.column(5).as_any().downcast_ref::<StringArray>().unwrap();
    let elevations = batch.column(6).as_any().downcast_ref::<Float64Array>().unwrap();
    let children_ids_col = batch.column(7).as_any().downcast_ref::<ListArray>().unwrap();
    let element_ids_col = batch.column(8).as_any().downcast_ref::<ListArray>().unwrap();

    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        let children_ids: Vec<u32> = if children_ids_col.is_valid(i) {
            let arr = children_ids_col.value(i);
            let u32_arr = arr.as_any().downcast_ref::<UInt32Array>().unwrap();
            (0..u32_arr.len()).map(|j| u32_arr.value(j)).collect()
        } else {
            Vec::new()
        };

        let element_ids: Vec<u32> = if element_ids_col.is_valid(i) {
            let arr = element_ids_col.value(i);
            let u32_arr = arr.as_any().downcast_ref::<UInt32Array>().unwrap();
            (0..u32_arr.len()).map(|j| u32_arr.value(j)).collect()
        } else {
            Vec::new()
        };

        let name_str = if names.is_valid(i) {
            let s = names.value(i);
            if s.is_empty() { None } else { Some(s.to_string()) }
        } else {
            None
        };

        let elevation = if elevations.is_valid(i) {
            Some(elevations.value(i))
        } else {
            None
        };

        result.push(SpatialNode {
            entity_id: entity_ids.value(i),
            parent_id: if parent_ids.is_valid(i) { parent_ids.value(i) } else { 0 },
            level: levels.value(i),
            path: paths.value(i).to_string(),
            type_name: type_names.value(i).to_string(),
            name: name_str,
            elevation,
            children_ids,
            element_ids,
        });
    }
    Ok(result)
}

fn deserialize_lookup_pairs(data: &[u8]) -> Result<Vec<(u32, u32)>, DataModelParquetError> {
    let batch = read_parquet_batch(data)?;
    let count = batch.num_rows();

    let element_ids = batch.column(0).as_any().downcast_ref::<UInt32Array>().unwrap();
    let spatial_ids = batch.column(1).as_any().downcast_ref::<UInt32Array>().unwrap();

    let mut result = Vec::with_capacity(count);
    for i in 0..count {
        result.push((element_ids.value(i), spatial_ids.value(i)));
    }
    Ok(result)
}
