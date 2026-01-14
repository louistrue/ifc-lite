// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Unit extraction and conversion for IFC files
//!
//! Handles parsing of IFCSIUNIT and applying SI prefix multipliers
//! to geometry coordinates.

use crate::decoder::EntityDecoder;
use crate::error::Result;

/// SI Prefix multipliers as defined in IFC specification
/// Maps IfcSIPrefix enum values to their numeric multipliers
#[inline]
pub fn get_si_prefix_multiplier(prefix: &str) -> f64 {
    match prefix {
        "ATTO" => 1e-18,
        "FEMTO" => 1e-15,
        "PICO" => 1e-12,
        "NANO" => 1e-9,
        "MICRO" => 1e-6,
        "MILLI" => 1e-3,   // Most common: millimeters
        "CENTI" => 1e-2,   // Centimeters
        "DECI" => 1e-1,    // Decimeters
        "DECA" => 1e1,     // Dekameters
        "HECTO" => 1e2,    // Hectometers
        "KILO" => 1e3,     // Kilometers
        "MEGA" => 1e6,
        "GIGA" => 1e9,
        "TERA" => 1e12,
        "PETA" => 1e15,
        "EXA" => 1e18,
        _ => 1.0,          // No prefix or unknown = base unit (meters)
    }
}

/// Extract length unit scale factor from IFC file
///
/// Follows the chain: IFCPROJECT → IFCUNITASSIGNMENT → IFCSIUNIT
/// Returns the multiplier to convert coordinates to base meters
///
/// # Arguments
/// * `decoder` - Entity decoder for the IFC file
/// * `project_id` - Entity ID of the IFCPROJECT
///
/// # Returns
/// Scale factor to apply to all coordinates (e.g., 0.001 for millimeters)
pub fn extract_length_unit_scale(decoder: &mut EntityDecoder, project_id: u32) -> Result<f64> {
    // Decode IFCPROJECT entity
    let project = decoder.decode_by_id(project_id)?;

    if project.ifc_type.as_str() != "IFCPROJECT" {
        return Ok(1.0); // Not a project, default to meters
    }

    // IFCPROJECT structure:
    // Attribute 0: GlobalId
    // Attribute 1: OwnerHistory
    // Attribute 2: Name
    // Attribute 3: Description
    // Attribute 4: ObjectType
    // Attribute 5: LongName
    // Attribute 6: Phase
    // Attribute 7: RepresentationContexts
    // Attribute 8: UnitsInContext (IFCUNITASSIGNMENT)

    let units_attr = match project.get(8) {
        Some(attr) => attr,
        None => return Ok(1.0), // No units defined, default to meters
    };

    // Resolve IFCUNITASSIGNMENT reference
    let units_ref = match units_attr.as_entity_ref() {
        Some(ref_id) => ref_id,
        None => return Ok(1.0), // No units reference
    };

    let unit_assignment = decoder.decode_by_id(units_ref)?;

    if unit_assignment.ifc_type.as_str() != "IFCUNITASSIGNMENT" {
        return Ok(1.0); // Wrong type
    }

    // IFCUNITASSIGNMENT has a single attribute: Units (list of IFCUNIT)
    let units_list_attr = match unit_assignment.get(0) {
        Some(attr) => attr,
        None => return Ok(1.0), // No units list
    };

    let units_list = match units_list_attr.as_list() {
        Some(list) => list,
        None => return Ok(1.0), // Not a list
    };

    // Search for IFCSIUNIT with .LENGTHUNIT.
    for unit_attr in units_list {
        let unit_ref = match unit_attr.as_entity_ref() {
            Some(ref_id) => ref_id,
            None => continue,
        };

        let unit_entity = match decoder.decode_by_id(unit_ref) {
            Ok(entity) => entity,
            Err(_) => continue, // Failed to decode, skip
        };

        if unit_entity.ifc_type.as_str() != "IFCSIUNIT" {
            continue; // Skip non-SI units (IfcConversionBasedUnit, etc.)
        }

        // IFCSIUNIT structure:
        // Attribute 0: Dimensions (can be *)
        // Attribute 1: UnitType (.LENGTHUNIT., .AREAUNIT., etc.)
        // Attribute 2: Prefix (.MILLI., .CENTI., etc.) - THIS IS WHAT WE NEED!
        // Attribute 3: Name (.METRE., .SQUARE_METRE., etc.)

        // Check if this is a length unit
        let unit_type_attr = match unit_entity.get(1) {
            Some(attr) => attr,
            None => continue,
        };

        // Enums are stored as Enum(String), extract via as_string()
        let unit_type = match unit_type_attr.as_string() {
            Some(type_str) => type_str,
            None => continue,
        };

        if unit_type != "LENGTHUNIT" {
            continue; // Not a length unit, skip
        }

        // Extract the SI prefix (attribute 2)
        let prefix_attr = match unit_entity.get(2) {
            Some(attr) => attr,
            None => return Ok(1.0), // No prefix = base meters
        };

        // Prefix can be an enum or null ($)
        if prefix_attr.is_null() {
            return Ok(1.0); // Null means no prefix = base meters
        }

        // Enums are stored as Enum(String), extract via as_string()
        let prefix = match prefix_attr.as_string() {
            Some(prefix_str) => prefix_str,
            None => return Ok(1.0), // Can't read prefix, assume meters
        };

        // Calculate and return the multiplier
        return Ok(get_si_prefix_multiplier(prefix));
    }

    // No length unit found, default to meters
    Ok(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_si_prefix_multipliers() {
        assert_eq!(get_si_prefix_multiplier("MILLI"), 0.001);
        assert_eq!(get_si_prefix_multiplier("CENTI"), 0.01);
        assert_eq!(get_si_prefix_multiplier("DECI"), 0.1);
        assert_eq!(get_si_prefix_multiplier("KILO"), 1000.0);
        assert_eq!(get_si_prefix_multiplier(""), 1.0);
        assert_eq!(get_si_prefix_multiplier("UNKNOWN"), 1.0);
    }
}
