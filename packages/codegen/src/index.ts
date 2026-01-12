/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * @ifc-lite/codegen
 *
 * TypeScript code generator from IFC EXPRESS schemas
 */

export {
  parseExpressSchema,
  getAllAttributes,
  getInheritanceChain,
  type ExpressSchema,
  type EntityDefinition,
  type AttributeDefinition,
  type TypeDefinition,
  type EnumDefinition,
  type SelectDefinition,
  type DerivedAttribute,
  type InverseAttribute,
} from './express-parser.js';

export {
  generateTypeScript,
  writeGeneratedFiles,
  type GeneratedCode,
} from './typescript-generator.js';

export { generateFromFile, generateFromSchema } from './generator.js';
