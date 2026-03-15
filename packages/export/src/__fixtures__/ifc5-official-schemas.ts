/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Official IFC5 schema definitions loaded DYNAMICALLY from the real
 * buildingSMART schema files (source of truth: github.com/buildingSMART/ifcx.dev).
 *
 * The .ifcx schema files are committed under __fixtures__/schemas/ and loaded
 * at test time so that any upstream schema change is caught automatically.
 *
 * Schema files:
 * - @standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx
 * - @standards.buildingsmart.org/ifc/core/prop@v5a.ifcx
 * - @openusd.org/usd@v1.ifcx
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Schema value description types (from the IFCX TypeSpec meta-schema)
// ============================================================================

export interface SchemaValueDescription {
  dataType: 'Real' | 'Boolean' | 'Integer' | 'String' | 'DateTime' | 'Enum' | 'Array' | 'Object' | 'Reference' | 'Blob';
  optional?: boolean;
  inherits?: string[];
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
// Load real schema files from buildingSMART/ifcx.dev
// ============================================================================

const SCHEMAS_DIR = resolve(__dirname, 'schemas');

function loadSchemaFile(filename: string): Record<string, SchemaDefinition> {
  const content = JSON.parse(readFileSync(resolve(SCHEMAS_DIR, filename), 'utf-8'));
  return content.schemas ?? {};
}

/** IFC core schemas from ifc@v5a.ifcx */
export const IFC_CORE_SCHEMAS: Record<string, SchemaDefinition> = loadSchemaFile('ifc@v5a.ifcx');

/** IFC property schemas from prop@v5a.ifcx */
export const IFC_PROP_SCHEMAS: Record<string, SchemaDefinition> = loadSchemaFile('prop@v5a.ifcx');

/** USD schemas from usd@v1.ifcx */
export const USD_SCHEMAS: Record<string, SchemaDefinition> = loadSchemaFile('usd@v1.ifcx');

/** All official schemas combined */
export const ALL_OFFICIAL_SCHEMAS: Record<string, SchemaDefinition> = {
  ...IFC_CORE_SCHEMAS,
  ...IFC_PROP_SCHEMAS,
  ...USD_SCHEMAS,
};

// ============================================================================
// Namespace → schema file mapping (mirrors what the viewer resolves)
// ============================================================================

/**
 * Maps attribute key prefixes to which schema file defines them.
 * The viewer resolves schemas by checking which imported .ifcx file defines a
 * given attribute key. If the key's namespace has an import but no matching
 * schema definition, it's an error.
 */
const NAMESPACE_SCHEMA_MAP: Record<string, Record<string, SchemaDefinition>> = {
  'bsi::ifc::prop::': IFC_PROP_SCHEMAS,
  'bsi::ifc::': IFC_CORE_SCHEMAS,
  'usd::': USD_SCHEMAS,
};

function findSchemaForKey(key: string): { schema: SchemaDefinition | undefined; namespaceMatched: boolean } {
  for (const [prefix, schemas] of Object.entries(NAMESPACE_SCHEMA_MAP)) {
    if (key.startsWith(prefix)) {
      return { schema: schemas[key], namespaceMatched: true };
    }
  }
  return { schema: undefined, namespaceMatched: false };
}

// ============================================================================
// Standard import URIs
// ============================================================================

export const STANDARD_IMPORT_URIS = {
  IFC_CORE: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/ifc@v5a.ifcx',
  IFC_PROP: 'https://ifcx.dev/@standards.buildingsmart.org/ifc/core/prop@v5a.ifcx',
  USD: 'https://ifcx.dev/@openusd.org/usd@v1.ifcx',
} as const;

// ============================================================================
// Validation helpers
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
        for (let i = 0; i < value.length; i++) {
          errors.push(...validateValue(value[i], schema.arrayRestrictions.value, `${path}[${i}]`));
        }
      }
      break;

    case 'Object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        errors.push(`${path}: Expected Object, got ${Array.isArray(value) ? 'Array' : typeof value}`);
      } else if (schema.objectRestrictions?.values) {
        const obj = value as Record<string, unknown>;
        for (const [key, valSchema] of Object.entries(schema.objectRestrictions.values)) {
          if (!valSchema.optional && !(key in obj)) {
            errors.push(`${path}: Missing required key "${key}"`);
          }
          if (key in obj) {
            errors.push(...validateValue(obj[key], valSchema, `${path}.${key}`));
          }
        }
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
 *
 * This mirrors the viewer's validation logic:
 * 1. Every attribute key must either be defined in an imported schema, defined
 *    in the file's local `schemas` section, or belong to an unrecognized namespace.
 * 2. If an attribute's namespace matches an imported schema file but the specific
 *    key is NOT defined in that schema file → "Missing schema" error (exactly
 *    what the BSI viewer reports).
 * 3. Values are type-checked against their schema definitions.
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

  // Collect local schemas (files can define their own schemas inline)
  const localSchemas: Record<string, SchemaDefinition> = file.schemas ?? {};

  // Validate each data node
  for (const node of file.data ?? []) {
    if (typeof node.path !== 'string') {
      errors.push(`Data node missing "path" field`);
      continue;
    }

    for (const [attrKey, attrVal] of Object.entries(node.attributes ?? {})) {
      // Check local schemas first
      if (localSchemas[attrKey]) {
        errors.push(...validateValue(attrVal, localSchemas[attrKey].value, `["${node.path}"].attributes["${attrKey}"]`));
        continue;
      }

      // Check official schemas
      const { schema, namespaceMatched } = findSchemaForKey(attrKey);

      if (schema) {
        // Known schema — validate value type
        errors.push(...validateValue(attrVal, schema.value, `["${node.path}"].attributes["${attrKey}"]`));
      } else if (namespaceMatched) {
        // Namespace matches an imported schema file, but this specific key
        // is NOT defined → this is what the BSI viewer reports as
        // 'Missing schema "bsi::ifc::prop::Reference"'
        errors.push(
          `["${node.path}"].attributes: Missing schema "${attrKey}" ` +
          `(not defined in the official schema files)`
        );
      }
      // If namespace doesn't match any known import, it's a custom/extension
      // attribute and we don't validate it (same as the viewer).
    }
  }

  return errors;
}
