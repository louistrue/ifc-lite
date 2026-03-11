/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Official IFC5 schema definitions from buildingSMART.
 *
 * Source: https://github.com/buildingSMART/ifcx.dev
 * - @standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx
 * - @standards.buildingsmart.org/ifc/core/prop@v5a.ifcx
 * - @openusd.org/usd@v1.ifcx
 *
 * These are used for validating export output against the official spec.
 */

// ============================================================================
// Schema value description types (from the IFCX meta-schema)
// ============================================================================

export interface SchemaValueDescription {
  dataType: 'Real' | 'Boolean' | 'Integer' | 'String' | 'DateTime' | 'Enum' | 'Array' | 'Object' | 'Reference' | 'Blob';
  optional?: boolean;
  quantityKind?: string;
  enumRestrictions?: { options: string[] };
  arrayRestrictions?: { value: SchemaValueDescription; min?: number; max?: number };
  objectRestrictions?: { values: Record<string, SchemaValueDescription> };
}

export interface SchemaDefinition {
  value: SchemaValueDescription;
  uri?: string;
}

// ============================================================================
// IFC Core schemas (ifc@v5a.ifcx)
// ============================================================================

export const IFC_CORE_SCHEMAS: Record<string, SchemaDefinition> = {
  'bsi::ifc::class': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          code: { dataType: 'String' },
          uri: { dataType: 'String' },
        },
      },
    },
  },
  'bsi::ifc::presentation::diffuseColor': {
    value: { dataType: 'Array', arrayRestrictions: { value: { dataType: 'Real' } } },
  },
  'bsi::ifc::presentation::opacity': {
    value: { dataType: 'Real' },
  },
  'bsi::ifc::material': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          code: { dataType: 'String' },
          uri: { dataType: 'String' },
        },
      },
    },
  },
  'bsi::ifc::spaceBoundary': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          relatedelement: {
            dataType: 'Object',
            objectRestrictions: { values: { ref: { dataType: 'String' } } },
          },
          relatingspace: {
            dataType: 'Object',
            objectRestrictions: { values: { ref: { dataType: 'String' } } },
          },
        },
      },
    },
  },
};

// ============================================================================
// IFC Property schemas (prop@v5a.ifcx)
// ============================================================================

export const IFC_PROP_SCHEMAS: Record<string, SchemaDefinition> = {
  'bsi::ifc::prop::Name': { value: { dataType: 'String' } },
  'bsi::ifc::prop::Description': { value: { dataType: 'String' } },
  'bsi::ifc::prop::UsageType': { value: { dataType: 'String' } },
  'bsi::ifc::prop::TypeName': { value: { dataType: 'String' } },
  'bsi::ifc::prop::IsExternal': { value: { dataType: 'Boolean' } },
  'bsi::ifc::prop::Height': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::Width': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::Length': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::Depth': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::Volume': { value: { dataType: 'Real', quantityKind: 'Volume' } },
  'bsi::ifc::prop::NetVolume': { value: { dataType: 'Real', quantityKind: 'Volume' } },
  'bsi::ifc::prop::NetArea': { value: { dataType: 'Real', quantityKind: 'Area' } },
  'bsi::ifc::prop::NetSideArea': { value: { dataType: 'Real', quantityKind: 'Area' } },
  'bsi::ifc::prop::CrossSectionArea': { value: { dataType: 'Real', quantityKind: 'Area' } },
  'bsi::ifc::prop::RefElevation': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::ElevationOfRefHeight': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::ElevationOfTerrain': { value: { dataType: 'Real', quantityKind: 'Length' } },
  'bsi::ifc::prop::NumberOfStoreys': { value: { dataType: 'Integer' } },
  'bsi::ifc::prop::Station': { value: { dataType: 'Real' } },
};

// ============================================================================
// USD schemas (usd@v1.ifcx)
// ============================================================================

export const USD_SCHEMAS: Record<string, SchemaDefinition> = {
  'usd::usdgeom::mesh': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          faceVertexIndices: {
            dataType: 'Array',
            arrayRestrictions: { value: { dataType: 'Integer' } },
          },
          points: {
            dataType: 'Array',
            arrayRestrictions: {
              value: {
                dataType: 'Array',
                arrayRestrictions: { value: { dataType: 'Real' } },
              },
            },
          },
        },
      },
    },
  },
  'usd::usdgeom::visibility': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          visibility: { dataType: 'String' },
        },
      },
    },
  },
  'usd::xformop': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          transform: {
            dataType: 'Array',
            arrayRestrictions: {
              value: {
                dataType: 'Array',
                arrayRestrictions: { value: { dataType: 'Real' } },
              },
            },
          },
        },
      },
    },
  },
  'usd::usdgeom::basiscurves': {
    value: {
      dataType: 'Object',
      objectRestrictions: {
        values: {
          points: {
            dataType: 'Array',
            arrayRestrictions: {
              value: {
                dataType: 'Array',
                arrayRestrictions: { value: { dataType: 'Real' } },
              },
            },
          },
        },
      },
    },
  },
};

// ============================================================================
// Combined schemas for validation
// ============================================================================

export const ALL_OFFICIAL_SCHEMAS: Record<string, SchemaDefinition> = {
  ...IFC_CORE_SCHEMAS,
  ...IFC_PROP_SCHEMAS,
  ...USD_SCHEMAS,
};

// ============================================================================
// Standard import URIs
// ============================================================================

export const STANDARD_IMPORT_URIS = {
  IFC_CORE: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx',
  IFC_PROP: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx',
  USD: 'https://ifcx.dev/@openusd.org/usd@v1.ifcx',
} as const;

// ============================================================================
// Validation helper
// ============================================================================

/**
 * Validate a value against a schema value description.
 * Returns an array of error messages (empty = valid).
 */
export function validateValue(
  value: unknown,
  schema: SchemaValueDescription,
  path: string,
): string[] {
  const errors: string[] = [];

  if (value === null || value === undefined) {
    if (!schema.optional) {
      errors.push(`${path}: Required value is null/undefined`);
    }
    return errors;
  }

  switch (schema.dataType) {
    case 'String':
      if (typeof value !== 'string') {
        errors.push(`${path}: Expected String, got ${typeof value}`);
      }
      break;

    case 'Real':
      if (typeof value !== 'number') {
        errors.push(`${path}: Expected Real (number), got ${typeof value}`);
      }
      break;

    case 'Integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        errors.push(`${path}: Expected Integer, got ${typeof value}${typeof value === 'number' ? ` (${value})` : ''}`);
      }
      break;

    case 'Boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path}: Expected Boolean, got ${typeof value}`);
      }
      break;

    case 'Array':
      if (!Array.isArray(value)) {
        errors.push(`${path}: Expected Array, got ${typeof value}`);
      } else if (schema.arrayRestrictions?.value) {
        for (let i = 0; i < Math.min(value.length, 5); i++) {
          errors.push(...validateValue(value[i], schema.arrayRestrictions.value, `${path}[${i}]`));
        }
      }
      break;

    case 'Object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: Expected Object, got ${Array.isArray(value) ? 'Array' : typeof value}`);
      } else if (schema.objectRestrictions?.values) {
        const obj = value as Record<string, unknown>;
        // Check required keys exist
        for (const [key, valSchema] of Object.entries(schema.objectRestrictions.values)) {
          if (!valSchema.optional && !(key in obj)) {
            errors.push(`${path}: Missing required key "${key}"`);
          }
          if (key in obj) {
            errors.push(...validateValue(obj[key], valSchema, `${path}.${key}`));
          }
        }
        // Check for unknown keys
        for (const key of Object.keys(obj)) {
          if (!(key in schema.objectRestrictions.values)) {
            errors.push(`${path}: Unknown key "${key}" (allowed: ${Object.keys(schema.objectRestrictions.values).join(', ')})`);
          }
        }
      }
      break;

    case 'Enum':
      if (typeof value !== 'string') {
        errors.push(`${path}: Expected Enum (string), got ${typeof value}`);
      } else if (schema.enumRestrictions?.options && !schema.enumRestrictions.options.includes(value)) {
        errors.push(`${path}: Invalid enum value "${value}" (allowed: ${schema.enumRestrictions.options.join(', ')})`);
      }
      break;
  }

  return errors;
}

/**
 * Validate an entire IFCX file against the official schemas.
 * Returns an array of error messages (empty = valid).
 */
export function validateIfcxFile(file: any): string[] {
  const errors: string[] = [];

  // Validate top-level structure
  if (!file.header) errors.push('Missing "header" field');
  if (!Array.isArray(file.imports)) errors.push('"imports" must be an array');
  if (typeof file.schemas !== 'object') errors.push('"schemas" must be an object');
  if (!Array.isArray(file.data)) errors.push('"data" must be an array');

  // Validate imports format
  for (const imp of file.imports ?? []) {
    if (typeof imp !== 'object' || typeof imp.uri !== 'string') {
      errors.push(`Import must be an object with "uri" string, got: ${JSON.stringify(imp)}`);
    }
  }

  // Validate each data node
  for (const node of file.data ?? []) {
    if (typeof node.path !== 'string') {
      errors.push(`Data node missing "path" field`);
      continue;
    }

    for (const [attrKey, attrVal] of Object.entries(node.attributes ?? {})) {
      const schema = ALL_OFFICIAL_SCHEMAS[attrKey];
      if (schema) {
        // Known schema — validate value
        errors.push(...validateValue(attrVal, schema.value, `["${node.path}"].attributes["${attrKey}"]`));
      }
      // For bsi::ifc::prop:: attributes not in the standard set, we allow them
      // (files can define custom properties in their local schemas section)
    }
  }

  return errors;
}
