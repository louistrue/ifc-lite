/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TypeScript Code Generator
 *
 * Generates TypeScript interfaces, types, and schema registry from parsed EXPRESS schemas.
 */

import type {
  ExpressSchema,
  EntityDefinition,
  AttributeDefinition,
  EnumDefinition,
  SelectDefinition,
  TypeDefinition,
} from './express-parser.js';
import { getAllAttributes, getInheritanceChain } from './express-parser.js';

export interface GeneratedCode {
  entities: string;       // Entity interfaces
  types: string;          // Type aliases
  enums: string;          // Enum definitions
  selects: string;        // Union types
  schemaRegistry: string; // Runtime schema metadata
}

/**
 * Generate all TypeScript code from EXPRESS schema
 */
export function generateTypeScript(schema: ExpressSchema): GeneratedCode {
  return {
    entities: generateEntityInterfaces(schema),
    types: generateTypeAliases(schema),
    enums: generateEnums(schema),
    selects: generateSelectTypes(schema),
    schemaRegistry: generateSchemaRegistry(schema),
  };
}

/**
 * Generate entity interfaces
 */
function generateEntityInterfaces(schema: ExpressSchema): string {
  let code = `/**
 * IFC Entity Interfaces
 * Generated from EXPRESS schema: ${schema.name}
 *
 * DO NOT EDIT - This file is auto-generated
 */

`;

  // Sort entities by dependency order (parents before children)
  const sortedEntities = topologicalSort(schema.entities);

  for (const entity of sortedEntities) {
    code += generateEntityInterface(entity, schema);
    code += '\n\n';
  }

  return code;
}

/**
 * Generate a single entity interface
 */
function generateEntityInterface(
  entity: EntityDefinition,
  schema: ExpressSchema
): string {
  let code = '';

  // Add JSDoc comment
  code += `/**\n * ${entity.name}\n`;
  if (entity.isAbstract) {
    code += ` * @abstract\n`;
  }
  if (entity.supertype) {
    code += ` * @extends ${entity.supertype}\n`;
  }
  code += ` */\n`;

  // Generate interface
  code += `export interface ${entity.name}`;

  // Add extends clause
  if (entity.supertype) {
    code += ` extends ${entity.supertype}`;
  }

  code += ` {\n`;

  // Add attributes (only this level, not inherited)
  for (const attr of entity.attributes) {
    code += generateAttribute(attr);
  }

  code += `}`;

  return code;
}

/**
 * Generate an attribute declaration
 */
function generateAttribute(attr: AttributeDefinition): string {
  let code = `  ${attr.name}`;

  // Add optional marker
  if (attr.optional) {
    code += '?';
  }

  code += ': ';

  // Map EXPRESS type to TypeScript type
  let tsType = mapExpressTypeToTypeScript(attr.type);

  // Wrap in array if needed
  // Note: attr.type may already contain [] for nested collections from the parser
  if (attr.isArray || attr.isList || attr.isSet) {
    tsType = `${tsType}[]`;
  }

  code += tsType;
  code += ';\n';

  return code;
}

/**
 * Map EXPRESS types to TypeScript types
 */
function mapExpressTypeToTypeScript(expressType: string): string {
  // Handle basic EXPRESS types
  const typeMap: Record<string, string> = {
    REAL: 'number',
    INTEGER: 'number',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    LOGICAL: 'boolean | null',
    STRING: 'string',
    BINARY: 'string',
  };

  // Check if it's a measure type (ends with Measure)
  if (expressType.endsWith('Measure')) {
    return 'number';
  }

  // Check if it's a simple type in our map
  const upperType = expressType.toUpperCase();
  if (typeMap[upperType]) {
    return typeMap[upperType];
  }

  // Check for IFC types
  if (expressType.startsWith('Ifc')) {
    return expressType;
  }

  // Default: use as-is (likely a custom type or entity reference)
  return expressType;
}

/**
 * Generate type aliases
 */
function generateTypeAliases(schema: ExpressSchema): string {
  let code = `/**
 * IFC Type Aliases
 * Generated from EXPRESS schema: ${schema.name}
 *
 * DO NOT EDIT - This file is auto-generated
 */

`;

  for (const type of schema.types) {
    code += `/** ${type.name} */\n`;
    code += `export type ${type.name} = ${mapExpressTypeToTypeScript(type.underlyingType)};\n\n`;
  }

  return code;
}

/**
 * Generate enum definitions
 */
function generateEnums(schema: ExpressSchema): string {
  let code = `/**
 * IFC Enumerations
 * Generated from EXPRESS schema: ${schema.name}
 *
 * DO NOT EDIT - This file is auto-generated
 */

`;

  for (const enumDef of schema.enums) {
    code += generateEnum(enumDef);
    code += '\n\n';
  }

  return code;
}

/**
 * Generate a single enum
 */
function generateEnum(enumDef: EnumDefinition): string {
  let code = `/** ${enumDef.name} */\n`;
  code += `export enum ${enumDef.name} {\n`;

  for (const value of enumDef.values) {
    // Convert to PascalCase for enum member
    const memberName = value.toUpperCase();
    code += `  ${memberName} = '${value}',\n`;
  }

  code += `}`;

  return code;
}

/**
 * Generate SELECT type unions
 */
function generateSelectTypes(schema: ExpressSchema): string {
  let code = `/**
 * IFC SELECT Types (Unions)
 * Generated from EXPRESS schema: ${schema.name}
 *
 * DO NOT EDIT - This file is auto-generated
 */

`;

  for (const select of schema.selects) {
    code += `/** ${select.name} */\n`;
    code += `export type ${select.name} = `;

    // Join types with |
    const tsTypes = select.types.map(t => mapExpressTypeToTypeScript(t));
    code += tsTypes.join(' | ');

    code += ';\n\n';
  }

  return code;
}

/**
 * Generate schema registry with runtime metadata
 */
function generateSchemaRegistry(schema: ExpressSchema): string {
  let code = `/**
 * IFC Schema Registry
 * Generated from EXPRESS schema: ${schema.name}
 *
 * Runtime metadata for IFC entities, types, and relationships.
 *
 * DO NOT EDIT - This file is auto-generated
 */

export interface EntityMetadata {
  name: string;
  isAbstract: boolean;
  parent?: string;
  attributes: AttributeMetadata[];
  allAttributes?: AttributeMetadata[];  // Including inherited
  inheritanceChain?: string[];  // From root to entity
}

export interface AttributeMetadata {
  name: string;
  type: string;
  optional: boolean;
  isArray: boolean;
  isList: boolean;
  isSet: boolean;
  arrayBounds?: [number, number];
}

export interface SchemaRegistry {
  name: string;
  entities: Record<string, EntityMetadata>;
  types: Record<string, string>;  // name -> underlying type
  enums: Record<string, string[]>;  // name -> values
  selects: Record<string, string[]>;  // name -> types
}

export const SCHEMA_REGISTRY: SchemaRegistry = {
  name: '${schema.name}',

  entities: {
`;

  // Generate entity metadata
  for (const entity of schema.entities) {
    code += generateEntityMetadata(entity, schema);
  }

  code += `  },

  types: {
`;

  // Generate type metadata (escape single quotes in underlying types)
  for (const type of schema.types) {
    const escapedType = type.underlyingType.replace(/'/g, "\\'").replace(/\n/g, ' ');
    code += `    ${type.name}: '${escapedType}',\n`;
  }

  code += `  },

  enums: {
`;

  // Generate enum metadata (escape single quotes in values)
  for (const enumDef of schema.enums) {
    const escapedValues = enumDef.values.map(v => `'${v.replace(/'/g, "\\'")}'`);
    code += `    ${enumDef.name}: [${escapedValues.join(', ')}],\n`;
  }

  code += `  },

  selects: {
`;

  // Generate select metadata (escape single quotes in types)
  for (const select of schema.selects) {
    const escapedTypes = select.types.map(t => `'${t.replace(/'/g, "\\'")}'`);
    code += `    ${select.name}: [${escapedTypes.join(', ')}],\n`;
  }

  code += `  },
};

/**
 * Get entity metadata by name (case-insensitive)
 */
export function getEntityMetadata(typeName: string): EntityMetadata | undefined {
  // Normalize to IfcXxx format
  const normalized = normalizeTypeName(typeName);
  return SCHEMA_REGISTRY.entities[normalized];
}

/**
 * Get all attributes for an entity (including inherited)
 */
export function getAllAttributesForEntity(typeName: string): AttributeMetadata[] {
  const metadata = getEntityMetadata(typeName);
  return metadata?.allAttributes || [];
}

/**
 * Get inheritance chain for an entity
 */
export function getInheritanceChainForEntity(typeName: string): string[] {
  const metadata = getEntityMetadata(typeName);
  return metadata?.inheritanceChain || [];
}

/**
 * Check if a type is a known entity
 */
export function isKnownEntity(typeName: string): boolean {
  const normalized = normalizeTypeName(typeName);
  return normalized in SCHEMA_REGISTRY.entities;
}

/**
 * Normalize type name to IfcXxx format
 */
function normalizeTypeName(name: string): string {
  // Convert IFCWALL -> IfcWall
  if (name.toUpperCase().startsWith('IFC')) {
    return 'Ifc' + name.substring(3).charAt(0).toUpperCase() +
           name.substring(4).toLowerCase();
  }
  return name;
}
`;

  return code;
}

/**
 * Generate metadata for a single entity
 */
function generateEntityMetadata(
  entity: EntityDefinition,
  schema: ExpressSchema
): string {
  let code = `    ${entity.name}: {\n`;
  code += `      name: '${entity.name}',\n`;
  code += `      isAbstract: ${entity.isAbstract},\n`;

  if (entity.supertype) {
    code += `      parent: '${entity.supertype}',\n`;
  }

  code += `      attributes: [\n`;
  for (const attr of entity.attributes) {
    code += `        {\n`;
    code += `          name: '${attr.name}',\n`;
    code += `          type: '${attr.type}',\n`;
    code += `          optional: ${attr.optional},\n`;
    code += `          isArray: ${attr.isArray},\n`;
    code += `          isList: ${attr.isList},\n`;
    code += `          isSet: ${attr.isSet},\n`;
    if (attr.arrayBounds) {
      code += `          arrayBounds: [${attr.arrayBounds[0]}, ${attr.arrayBounds[1]}],\n`;
    }
    code += `        },\n`;
  }
  code += `      ],\n`;

  // Add all attributes (including inherited)
  const allAttrs = getAllAttributes(entity, schema);
  code += `      allAttributes: [\n`;
  for (const attr of allAttrs) {
    code += `        {\n`;
    code += `          name: '${attr.name}',\n`;
    code += `          type: '${attr.type}',\n`;
    code += `          optional: ${attr.optional},\n`;
    code += `          isArray: ${attr.isArray},\n`;
    code += `          isList: ${attr.isList},\n`;
    code += `          isSet: ${attr.isSet},\n`;
    if (attr.arrayBounds) {
      code += `          arrayBounds: [${attr.arrayBounds[0]}, ${attr.arrayBounds[1]}],\n`;
    }
    code += `        },\n`;
  }
  code += `      ],\n`;

  // Add inheritance chain
  const chain = getInheritanceChain(entity, schema);
  code += `      inheritanceChain: [${chain.map(c => `'${c}'`).join(', ')}],\n`;

  code += `    },\n`;

  return code;
}

/**
 * Topological sort of entities by dependency order
 * Ensures parent entities are generated before children
 */
function topologicalSort(entities: EntityDefinition[]): EntityDefinition[] {
  const sorted: EntityDefinition[] = [];
  const visited = new Set<string>();

  function visit(entity: EntityDefinition) {
    if (visited.has(entity.name)) {
      return;
    }

    visited.add(entity.name);

    // Visit parent first
    if (entity.supertype) {
      const parent = entities.find(e => e.name === entity.supertype);
      if (parent) {
        visit(parent);
      }
    }

    sorted.push(entity);
  }

  for (const entity of entities) {
    visit(entity);
  }

  return sorted;
}

/**
 * Write generated code to files
 */
export function writeGeneratedFiles(
  code: GeneratedCode,
  outputDir: string
): { entities: string; types: string; enums: string; selects: string; schema: string } {
  return {
    entities: `${outputDir}/entities.ts`,
    types: `${outputDir}/types.ts`,
    enums: `${outputDir}/enums.ts`,
    selects: `${outputDir}/selects.ts`,
    schema: `${outputDir}/schema-registry.ts`,
  };
}
