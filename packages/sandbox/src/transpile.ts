/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TypeScript → JavaScript transpilation for the QuickJS sandbox.
 *
 * Strategy (two-tier, same as Node.js --experimental-strip-types):
 * 1. If esbuild is available (bundled in host app), use esbuild.transform()
 * 2. Fallback: regex-based type stripping for common patterns
 *
 * After transpilation, import/export statements are stripped since QuickJS
 * has no module system — scripts use the global `bim` object.
 *
 * Future: esbuild-wasm's build() API with a CDN resolver plugin would
 * enable npm package imports (e.g., import lodash from 'lodash').
 */

/** Esbuild-compatible transform interface */
interface EsbuildLike {
  transform: (code: string, options: { loader: string; target: string }) => Promise<{ code: string }>;
}

/** Cached esbuild module */
let cachedEsbuild: EsbuildLike | null | undefined;

/** Try to dynamically import esbuild */
async function importEsbuild(): Promise<EsbuildLike | null> {
  if (cachedEsbuild !== undefined) return cachedEsbuild;
  try {
    const moduleName = 'esbuild';
    cachedEsbuild = await import(/* webpackIgnore: true */ moduleName) as EsbuildLike;
  } catch {
    cachedEsbuild = null;
  }
  return cachedEsbuild;
}

/** Transpile TypeScript to JavaScript by stripping types, then strip imports */
export async function transpileTypeScript(code: string): Promise<string> {
  let js: string;

  // Try esbuild first (available if host app bundles it)
  try {
    const esbuild = await importEsbuild();
    if (esbuild) {
      const result = await esbuild.transform(code, {
        loader: 'ts',
        target: 'es2022',
      });
      js = result.code;
    } else {
      js = naiveTypeStrip(code);
    }
  } catch {
    js = naiveTypeStrip(code);
  }

  // Strip import/export statements — QuickJS has no module system
  return stripModuleSyntax(js);
}

/**
 * Strip import/export statements from JavaScript code.
 * QuickJS doesn't support ES modules, so scripts access the SDK via
 * the global `bim` object built by the bridge.
 */
function stripModuleSyntax(code: string): string {
  let result = code;

  // Remove import statements: import ... from '...' or import '...'
  result = result.replace(/^\s*import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"][^'"]*['"];?\s*$/gm, '');

  // Remove export keywords (keep the declaration): export const/function/class → const/function/class
  result = result.replace(/^\s*export\s+(default\s+)?(const|let|var|function|class|async\s+function)\s/gm, '$2 ');

  // Remove bare "export default" expression statements
  result = result.replace(/^\s*export\s+default\s+/gm, '');

  // Remove export { ... } and export { ... } from '...'
  result = result.replace(/^\s*export\s+\{[^}]*\}(?:\s+from\s+['"][^'"]*['"])?\s*;?\s*$/gm, '');

  return result;
}

/**
 * Naive type stripping — removes common TypeScript-only syntax.
 * Not a full parser, but handles the most common patterns in user scripts.
 */
function naiveTypeStrip(code: string): string {
  let result = code;

  // Remove interface declarations (including multiline)
  result = result.replace(/^\s*(?:export\s+)?interface\s+\w+[^{]*\{[^}]*\}/gm, '');

  // Remove type alias declarations
  result = result.replace(/^\s*(?:export\s+)?type\s+\w+\s*=\s*[^;]+;/gm, '');

  // Remove type annotations from variable declarations: const x: Type = ...
  result = result.replace(/:\s*(?:string|number|boolean|void|any|unknown|never|null|undefined|Record<[^>]+>|Array<[^>]+>|\w+(?:\[\])?)\s*(?=[=,);])/g, '');

  // Remove function return type annotations: function f(): Type {
  result = result.replace(/\):\s*(?:string|number|boolean|void|any|unknown|never|null|undefined|Promise<[^>]+>|\w+(?:\[\])?)\s*\{/g, ') {');

  // Remove `as Type` casts — but not import aliases like `import { Foo as Bar }`
  result = result.replace(/(?<![{,]\s*\w+\s)\s+as\s+\w+(?:\[\])?/g, '');

  // Remove generic type parameters: <T>, <T extends U>
  result = result.replace(/<\w+(?:\s+extends\s+\w+)?>/g, '');

  return result;
}
