// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Entity Decoder - On-demand entity parsing
//!
//! Lazily decode IFC entities from byte offsets without loading entire file into memory.

use crate::error::{Error, Result};
use crate::parser::{parse_entity, Token};
use crate::schema::IfcType;
use crate::schema_gen::{AttributeValue, DecodedEntity};
use rustc_hash::FxHashMap;

/// Pre-built entity index type
pub type EntityIndex = FxHashMap<u32, (usize, usize)>;

/// Build entity index from content - O(n) scan using SIMD-accelerated search
/// Returns index mapping entity IDs to byte offsets
pub fn build_entity_index(content: &str) -> EntityIndex {
    let bytes = content.as_bytes();
    let len = bytes.len();

    // Pre-allocate with estimated capacity (roughly 1 entity per 50 bytes)
    let estimated_entities = len / 50;
    let mut index = FxHashMap::with_capacity_and_hasher(estimated_entities, Default::default());

    let mut pos = 0;

    while pos < len {
        // Find next '#' using SIMD-accelerated search
        let remaining = &bytes[pos..];
        let hash_offset = match memchr::memchr(b'#', remaining) {
            Some(offset) => offset,
            None => break,
        };

        let start = pos + hash_offset;
        pos = start + 1;

        // Parse entity ID (inline for speed)
        let id_start = pos;
        while pos < len && bytes[pos].is_ascii_digit() {
            pos += 1;
        }

        if pos > id_start && pos < len && bytes[pos] == b'=' {
            // Fast integer parsing without allocation
            let id = parse_u32_inline(bytes, id_start, pos);

            // Find end of entity (;) using SIMD
            let entity_content = &bytes[pos..];
            if let Some(semicolon_offset) = memchr::memchr(b';', entity_content) {
                pos += semicolon_offset + 1; // Include semicolon
                index.insert(id, (start, pos));
            } else {
                break; // No semicolon found, malformed
            }
        }
    }

    index
}

/// Fast u32 parsing without string allocation
#[inline]
fn parse_u32_inline(bytes: &[u8], start: usize, end: usize) -> u32 {
    let mut result: u32 = 0;
    for i in start..end {
        let digit = bytes[i].wrapping_sub(b'0');
        result = result.wrapping_mul(10).wrapping_add(digit as u32);
    }
    result
}

/// Entity decoder for lazy parsing
pub struct EntityDecoder<'a> {
    content: &'a str,
    /// Cache of decoded entities (entity_id -> DecodedEntity)
    cache: FxHashMap<u32, DecodedEntity>,
    /// Index of entity offsets (entity_id -> (start, end))
    /// Can be pre-built or built lazily
    entity_index: Option<EntityIndex>,
}

impl<'a> EntityDecoder<'a> {
    /// Create new decoder
    pub fn new(content: &'a str) -> Self {
        Self {
            content,
            cache: FxHashMap::default(),
            entity_index: None,
        }
    }

    /// Create decoder with pre-built index (faster for repeated lookups)
    pub fn with_index(content: &'a str, index: EntityIndex) -> Self {
        Self {
            content,
            cache: FxHashMap::default(),
            entity_index: Some(index),
        }
    }

    /// Build entity index for O(1) lookups
    /// This scans the file once and maps entity IDs to byte offsets
    fn build_index(&mut self) {
        if self.entity_index.is_some() {
            return; // Already built
        }
        self.entity_index = Some(build_entity_index(self.content));
    }

    /// Decode entity at byte offset
    /// Returns cached entity if already decoded
    #[inline]
    pub fn decode_at(&mut self, start: usize, end: usize) -> Result<DecodedEntity> {
        let line = &self.content[start..end];
        let (id, ifc_type, tokens) = parse_entity(line).map_err(|e| {
            // Add debug info about what failed to parse
            Error::parse(0, format!("Failed to parse entity: {:?}, input: {:?}", e, &line[..line.len().min(100)]))
        })?;

        // Check cache first
        if let Some(entity) = self.cache.get(&id) {
            return Ok(entity.clone());
        }

        // Convert tokens to AttributeValues
        let attributes = tokens
            .iter()
            .map(|token| AttributeValue::from_token(token))
            .collect();

        let entity = DecodedEntity::new(id, ifc_type, attributes);
        self.cache.insert(id, entity.clone());
        Ok(entity)
    }

    /// Decode entity by ID - O(1) lookup using entity index
    #[inline]
    pub fn decode_by_id(&mut self, entity_id: u32) -> Result<DecodedEntity> {
        // Check cache first
        if let Some(entity) = self.cache.get(&entity_id) {
            return Ok(entity.clone());
        }

        // Build index if not already built
        self.build_index();

        // O(1) lookup in index
        let (start, end) = self.entity_index
            .as_ref()
            .and_then(|idx| idx.get(&entity_id).copied())
            .ok_or_else(|| Error::parse(0, format!("Entity #{} not found", entity_id)))?;

        self.decode_at(start, end)
    }

    /// Resolve entity reference (follow #ID)
    /// Returns None for null/derived values
    #[inline]
    pub fn resolve_ref(&mut self, attr: &AttributeValue) -> Result<Option<DecodedEntity>> {
        match attr.as_entity_ref() {
            Some(id) => Ok(Some(self.decode_by_id(id)?)),
            None => Ok(None),
        }
    }

    /// Resolve list of entity references
    pub fn resolve_ref_list(
        &mut self,
        attr: &AttributeValue,
    ) -> Result<Vec<DecodedEntity>> {
        let list = attr
            .as_list()
            .ok_or_else(|| Error::parse(0, "Expected list".to_string()))?;

        let mut entities = Vec::with_capacity(list.len());
        for item in list {
            if let Some(id) = item.as_entity_ref() {
                entities.push(self.decode_by_id(id)?);
            }
        }
        Ok(entities)
    }

    /// Get cached entity (without decoding)
    pub fn get_cached(&self, entity_id: u32) -> Option<DecodedEntity> {
        self.cache.get(&entity_id).cloned()
    }

    /// Clear cache to free memory
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }

    /// Get cache size
    pub fn cache_size(&self) -> usize {
        self.cache.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_entity() {
        let content = r#"
#1=IFCPROJECT('2vqT3bvqj9RBFjLlXpN8n9',$,$,$,$,$,$,$,$);
#2=IFCWALL('3a4T3bvqj9RBFjLlXpN8n0',$,$,$,'Wall-001',$,#3,#4);
#3=IFCLOCALPLACEMENT($,#4);
#4=IFCAXIS2PLACEMENT3D(#5,$,$);
#5=IFCCARTESIANPOINT((0.,0.,0.));
"#;

        let mut decoder = EntityDecoder::new(content);

        // Find entity #2
        let start = content.find("#2=").unwrap();
        let end = content[start..].find(';').unwrap() + start + 1;

        let entity = decoder.decode_at(start, end).unwrap();
        assert_eq!(entity.id, 2);
        assert_eq!(entity.ifc_type, IfcType::IfcWall);
        assert_eq!(entity.attributes.len(), 8);
        assert_eq!(entity.get_string(4), Some("Wall-001"));
        assert_eq!(entity.get_ref(6), Some(3));
        assert_eq!(entity.get_ref(7), Some(4));
    }

    #[test]
    fn test_decode_by_id() {
        let content = r#"
#1=IFCPROJECT('guid',$,$,$,$,$,$,$,$);
#5=IFCWALL('guid2',$,$,$,'Wall-001',$,$,$);
#10=IFCDOOR('guid3',$,$,$,'Door-001',$,$,$);
"#;

        let mut decoder = EntityDecoder::new(content);

        let entity = decoder.decode_by_id(5).unwrap();
        assert_eq!(entity.id, 5);
        assert_eq!(entity.ifc_type, IfcType::IfcWall);
        assert_eq!(entity.get_string(4), Some("Wall-001"));

        // Should be cached now
        assert_eq!(decoder.cache_size(), 1);
        let cached = decoder.get_cached(5).unwrap();
        assert_eq!(cached.id, 5);
    }

    #[test]
    fn test_resolve_ref() {
        let content = r#"
#1=IFCPROJECT('guid',$,$,$,$,$,$,$,$);
#2=IFCWALL('guid2',$,$,$,$,$,#1,$);
"#;

        let mut decoder = EntityDecoder::new(content);

        let wall = decoder.decode_by_id(2).unwrap();
        let placement_attr = wall.get(6).unwrap();

        let referenced = decoder.resolve_ref(placement_attr).unwrap().unwrap();
        assert_eq!(referenced.id, 1);
        assert_eq!(referenced.ifc_type, IfcType::IfcProject);
    }

    #[test]
    fn test_resolve_ref_list() {
        let content = r#"
#1=IFCPROJECT('guid',$,$,$,$,$,$,$,$);
#2=IFCWALL('guid1',$,$,$,$,$,$,$);
#3=IFCDOOR('guid2',$,$,$,$,$,$,$);
#4=IFCRELCONTAINEDINSPATIALSTRUCTURE('guid3',$,$,$,(#2,#3),$,#1);
"#;

        let mut decoder = EntityDecoder::new(content);

        let rel = decoder.decode_by_id(4).unwrap();
        let elements_attr = rel.get(4).unwrap();

        let elements = decoder.resolve_ref_list(elements_attr).unwrap();
        assert_eq!(elements.len(), 2);
        assert_eq!(elements[0].id, 2);
        assert_eq!(elements[0].ifc_type, IfcType::IfcWall);
        assert_eq!(elements[1].id, 3);
        assert_eq!(elements[1].ifc_type, IfcType::IfcDoor);
    }

    #[test]
    fn test_cache() {
        let content = r#"
#1=IFCPROJECT('guid',$,$,$,$,$,$,$,$);
#2=IFCWALL('guid2',$,$,$,$,$,$,$);
"#;

        let mut decoder = EntityDecoder::new(content);

        assert_eq!(decoder.cache_size(), 0);

        decoder.decode_by_id(1).unwrap();
        assert_eq!(decoder.cache_size(), 1);

        decoder.decode_by_id(2).unwrap();
        assert_eq!(decoder.cache_size(), 2);

        // Decode same entity - should use cache
        decoder.decode_by_id(1).unwrap();
        assert_eq!(decoder.cache_size(), 2);

        decoder.clear_cache();
        assert_eq!(decoder.cache_size(), 0);
    }
}
