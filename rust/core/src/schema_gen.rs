// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! IFC Schema - Dynamic type system
//!
//! Generated from IFC4 EXPRESS schema for maintainability.
//! All types are handled generically through enum dispatch.

use crate::schema::IfcType;
use crate::parser::Token;
use crate::error::{Error, Result};
use std::collections::HashMap;

/// IFC entity attribute value
#[derive(Debug, Clone)]
pub enum AttributeValue {
    /// Entity reference
    EntityRef(u32),
    /// String value
    String(String),
    /// Integer value
    Integer(i64),
    /// Float value
    Float(f64),
    /// Enum value
    Enum(String),
    /// List of values
    List(Vec<AttributeValue>),
    /// Null/undefined
    Null,
    /// Derived value (*)
    Derived,
}

impl AttributeValue {
    /// Convert from Token
    pub fn from_token(token: &Token) -> Self {
        match token {
            Token::EntityRef(id) => AttributeValue::EntityRef(*id),
            Token::String(s) => AttributeValue::String(s.to_string()),
            Token::Integer(i) => AttributeValue::Integer(*i),
            Token::Float(f) => AttributeValue::Float(*f),
            Token::Enum(e) => AttributeValue::Enum(e.to_string()),
            Token::List(items) => {
                AttributeValue::List(items.iter().map(Self::from_token).collect())
            }
            Token::TypedValue(type_name, args) => {
                // For typed values like IFCPARAMETERVALUE(0.), extract the inner value
                // Store as a list with the type name first, followed by args
                let mut values = vec![AttributeValue::String(type_name.to_string())];
                values.extend(args.iter().map(Self::from_token));
                AttributeValue::List(values)
            }
            Token::Null => AttributeValue::Null,
            Token::Derived => AttributeValue::Derived,
        }
    }

    /// Get as entity reference
    pub fn as_entity_ref(&self) -> Option<u32> {
        match self {
            AttributeValue::EntityRef(id) => Some(*id),
            _ => None,
        }
    }

    /// Get as string
    pub fn as_string(&self) -> Option<&str> {
        match self {
            AttributeValue::String(s) => Some(s),
            _ => None,
        }
    }

    /// Get as float
    pub fn as_float(&self) -> Option<f64> {
        match self {
            AttributeValue::Float(f) => Some(*f),
            AttributeValue::Integer(i) => Some(*i as f64),
            _ => None,
        }
    }

    /// Get as list
    pub fn as_list(&self) -> Option<&[AttributeValue]> {
        match self {
            AttributeValue::List(items) => Some(items),
            _ => None,
        }
    }

    /// Check if null/derived
    pub fn is_null(&self) -> bool {
        matches!(self, AttributeValue::Null | AttributeValue::Derived)
    }
}

/// Decoded IFC entity with attributes
#[derive(Debug, Clone)]
pub struct DecodedEntity {
    pub id: u32,
    pub ifc_type: IfcType,
    pub attributes: Vec<AttributeValue>,
}

impl DecodedEntity {
    /// Create new decoded entity
    pub fn new(id: u32, ifc_type: IfcType, attributes: Vec<AttributeValue>) -> Self {
        Self {
            id,
            ifc_type,
            attributes,
        }
    }

    /// Get attribute by index
    pub fn get(&self, index: usize) -> Option<&AttributeValue> {
        self.attributes.get(index)
    }

    /// Get entity reference attribute
    pub fn get_ref(&self, index: usize) -> Option<u32> {
        self.get(index).and_then(|v| v.as_entity_ref())
    }

    /// Get string attribute
    pub fn get_string(&self, index: usize) -> Option<&str> {
        self.get(index).and_then(|v| v.as_string())
    }

    /// Get float attribute
    pub fn get_float(&self, index: usize) -> Option<f64> {
        self.get(index).and_then(|v| v.as_float())
    }

    /// Get list attribute
    pub fn get_list(&self, index: usize) -> Option<&[AttributeValue]> {
        self.get(index).and_then(|v| v.as_list())
    }
}

/// IFC schema metadata for dynamic processing
#[derive(Clone)]
pub struct IfcSchema {
    /// Geometry representation types (for routing)
    pub geometry_types: HashMap<IfcType, GeometryCategory>,
    /// Profile types
    pub profile_types: HashMap<IfcType, ProfileCategory>,
}

/// Geometry representation category
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GeometryCategory {
    /// Swept solids (extrusion, revolution)
    SweptSolid,
    /// Boolean operations
    Boolean,
    /// Explicit meshes (Brep, triangulated)
    ExplicitMesh,
    /// Instanced geometry
    MappedItem,
    /// Other/unsupported
    Other,
}

/// Profile category
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProfileCategory {
    /// Parametric profiles (rectangle, circle, I-shape, etc.)
    Parametric,
    /// Arbitrary profiles (polyline-based)
    Arbitrary,
    /// Composite profiles
    Composite,
    /// Other
    Other,
}

impl IfcSchema {
    /// Create schema with geometry type mappings
    pub fn new() -> Self {
        let mut geometry_types = HashMap::new();
        let mut profile_types = HashMap::new();

        // Swept solids (P0)
        geometry_types.insert(IfcType::IfcExtrudedAreaSolid, GeometryCategory::SweptSolid);
        geometry_types.insert(IfcType::IfcRevolvedAreaSolid, GeometryCategory::SweptSolid);

        // Boolean operations (P0)
        geometry_types.insert(IfcType::IfcBooleanResult, GeometryCategory::Boolean);
        geometry_types.insert(IfcType::IfcBooleanClippingResult, GeometryCategory::Boolean);

        // Explicit meshes (P0)
        geometry_types.insert(IfcType::IfcFacetedBrep, GeometryCategory::ExplicitMesh);
        geometry_types.insert(IfcType::IfcTriangulatedFaceSet, GeometryCategory::ExplicitMesh);
        geometry_types.insert(IfcType::IfcPolygonalFaceSet, GeometryCategory::ExplicitMesh);

        // Instancing (P0)
        geometry_types.insert(IfcType::IfcMappedItem, GeometryCategory::MappedItem);

        // Profile types - Parametric
        profile_types.insert(IfcType::IfcRectangleProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcCircleProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcCircleHollowProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcIShapeProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcLShapeProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcUShapeProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcTShapeProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcCShapeProfileDef, ProfileCategory::Parametric);
        profile_types.insert(IfcType::IfcZShapeProfileDef, ProfileCategory::Parametric);

        // Profile types - Arbitrary
        profile_types.insert(IfcType::IfcArbitraryClosedProfileDef, ProfileCategory::Arbitrary);
        profile_types.insert(IfcType::IfcArbitraryProfileDefWithVoids, ProfileCategory::Arbitrary);

        // Profile types - Composite
        profile_types.insert(IfcType::IfcCompositeProfileDef, ProfileCategory::Composite);

        Self {
            geometry_types,
            profile_types,
        }
    }

    /// Get geometry category for a type
    pub fn geometry_category(&self, ifc_type: &IfcType) -> Option<GeometryCategory> {
        self.geometry_types.get(ifc_type).copied()
    }

    /// Get profile category for a type
    pub fn profile_category(&self, ifc_type: &IfcType) -> Option<ProfileCategory> {
        self.profile_types.get(ifc_type).copied()
    }

    /// Check if type is a geometry representation
    pub fn is_geometry_type(&self, ifc_type: &IfcType) -> bool {
        self.geometry_types.contains_key(ifc_type)
    }

    /// Check if type is a profile
    pub fn is_profile_type(&self, ifc_type: &IfcType) -> bool {
        self.profile_types.contains_key(ifc_type)
    }

    /// Check if type has geometry
    pub fn has_geometry(&self, ifc_type: &IfcType) -> bool {
        // Building elements, furnishing, etc.
        ifc_type.is_building_element() ||
        matches!(
            ifc_type,
            IfcType::IfcFurnishingElement
                | IfcType::IfcFurniture
                | IfcType::IfcDuctSegment
                | IfcType::IfcPipeSegment
                | IfcType::IfcCableSegment
        )
    }
}

impl Default for IfcSchema {
    fn default() -> Self {
        Self::new()
    }
}

// Note: IFC types are now defined as proper enum variants in schema.rs
// This avoids the issue where from_str() would return Unknown(hash) instead of matching the constant.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_schema_geometry_categories() {
        let schema = IfcSchema::new();

        assert_eq!(
            schema.geometry_category(&IfcType::IfcExtrudedAreaSolid),
            Some(GeometryCategory::SweptSolid)
        );

        assert_eq!(
            schema.geometry_category(&IfcType::IfcBooleanResult),
            Some(GeometryCategory::Boolean)
        );

        assert_eq!(
            schema.geometry_category(&IfcType::IfcTriangulatedFaceSet),
            Some(GeometryCategory::ExplicitMesh)
        );
    }

    #[test]
    fn test_attribute_value_conversion() {
        let token = Token::EntityRef(123);
        let attr = AttributeValue::from_token(&token);
        assert_eq!(attr.as_entity_ref(), Some(123));

        let token = Token::String("test");
        let attr = AttributeValue::from_token(&token);
        assert_eq!(attr.as_string(), Some("test"));
    }

    #[test]
    fn test_decoded_entity() {
        let entity = DecodedEntity::new(
            1,
            IfcType::IfcWall,
            vec![
                AttributeValue::EntityRef(2),
                AttributeValue::String("Wall-001".to_string()),
                AttributeValue::Float(3.5),
            ],
        );

        assert_eq!(entity.get_ref(0), Some(2));
        assert_eq!(entity.get_string(1), Some("Wall-001"));
        assert_eq!(entity.get_float(2), Some(3.5));
    }
}
