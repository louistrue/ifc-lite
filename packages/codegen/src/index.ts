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
