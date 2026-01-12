/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * High-level generator functions
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseExpressSchema } from './express-parser.js';
import { generateTypeScript, type GeneratedCode } from './typescript-generator.js';

/**
 * Generate TypeScript code from an EXPRESS schema file
 */
export function generateFromFile(schemaPath: string, outputDir: string): GeneratedCode {
  // Read schema file
  const content = readFileSync(schemaPath, 'utf-8');

  // Generate code
  return generateFromSchema(content, outputDir);
}

/**
 * Generate TypeScript code from EXPRESS schema content
 */
export function generateFromSchema(schemaContent: string, outputDir: string): GeneratedCode {
  console.log('📖 Parsing EXPRESS schema...');
  const schema = parseExpressSchema(schemaContent);

  console.log(`✓ Parsed ${schema.name}`);
  console.log(`  - ${schema.entities.length} entities`);
  console.log(`  - ${schema.types.length} types`);
  console.log(`  - ${schema.enums.length} enums`);
  console.log(`  - ${schema.selects.length} selects`);

  console.log('\n🔨 Generating TypeScript code...');
  const code = generateTypeScript(schema);

  console.log('💾 Writing generated files...');

  // Create output directory
  mkdirSync(outputDir, { recursive: true });

  // Write files
  writeFileSync(`${outputDir}/entities.ts`, code.entities);
  console.log(`  ✓ ${outputDir}/entities.ts`);

  writeFileSync(`${outputDir}/types.ts`, code.types);
  console.log(`  ✓ ${outputDir}/types.ts`);

  writeFileSync(`${outputDir}/enums.ts`, code.enums);
  console.log(`  ✓ ${outputDir}/enums.ts`);

  writeFileSync(`${outputDir}/selects.ts`, code.selects);
  console.log(`  ✓ ${outputDir}/selects.ts`);

  writeFileSync(`${outputDir}/schema-registry.ts`, code.schemaRegistry);
  console.log(`  ✓ ${outputDir}/schema-registry.ts`);

  // Write index file
  const indexContent = `/**
 * Generated IFC Schema
 *
 * DO NOT EDIT - This file is auto-generated
 */

export * from './entities.js';
export * from './types.js';
export * from './enums.js';
export * from './selects.js';
export * from './schema-registry.js';
`;
  writeFileSync(`${outputDir}/index.ts`, indexContent);
  console.log(`  ✓ ${outputDir}/index.ts`);

  console.log('\n✨ Code generation complete!');

  return code;
}
