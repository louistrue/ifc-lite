/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TypeScript → JavaScript transpilation via type stripping.
 *
 * We strip types without type-checking — same approach as Node.js --experimental-strip-types.
 * This is fast (<1ms for typical scripts) and doesn't require a full TypeScript compiler.
 *
 * Strategy:
 * 1. If esbuild is available (bundled in the host app), use esbuild.transform()
 * 2. Fallback: naive regex-based stripping for common patterns
 *
 * The sandbox executes the resulting JavaScript in QuickJS.
 */

/** Transpile TypeScript to JavaScript by stripping types */
export async function transpileTypeScript(code: string): Promise<string> {
  // Try esbuild first (available if host app bundles it)
  try {
    const esbuild = await importEsbuild();
    if (esbuild) {
      const result = await esbuild.transform(code, {
        loader: 'ts',
        target: 'es2022',
      });
      return result.code;
    }
  } catch {
    // esbuild not available, fall through to naive stripping
  }

  // Fallback: naive type stripping
  return naiveTypeStrip(code);
}

/** Esbuild-compatible transform interface */
interface EsbuildLike {
  transform: (code: string, options: { loader: string; target: string }) => Promise<{ code: string }>;
}

/** Try to dynamically import esbuild */
async function importEsbuild(): Promise<EsbuildLike | null> {
  try {
    // Dynamic import — only resolves if esbuild is installed in the host.
    // We use a variable to prevent TypeScript from statically resolving the module.
    const moduleName = 'esbuild';
    return await import(/* webpackIgnore: true */ moduleName) as EsbuildLike;
  } catch {
    return null;
  }
}

/**
 * Naive type stripping — removes common TypeScript-only syntax.
 * Not a full parser, but handles the most common patterns in user scripts.
 */
function naiveTypeStrip(code: string): string {
  let result = code;

  // Remove interface declarations
  result = result.replace(/^\s*(?:export\s+)?interface\s+\w+[^{]*\{[^}]*\}/gm, '');

  // Remove type alias declarations
  result = result.replace(/^\s*(?:export\s+)?type\s+\w+\s*=\s*[^;]+;/gm, '');

  // Remove type annotations from variable declarations: const x: Type = ...
  result = result.replace(/:\s*(?:string|number|boolean|void|any|unknown|never|null|undefined|Record<[^>]+>|Array<[^>]+>|\w+(?:\[\])?)\s*(?=[=,);])/g, '');

  // Remove function return type annotations: function f(): Type {
  result = result.replace(/\):\s*(?:string|number|boolean|void|any|unknown|never|null|undefined|Promise<[^>]+>|\w+(?:\[\])?)\s*\{/g, ') {');

  // Remove `as Type` casts
  result = result.replace(/\s+as\s+\w+(?:\[\])?/g, '');

  // Remove generic type parameters: <T>, <T extends U>
  result = result.replace(/<\w+(?:\s+extends\s+\w+)?>/g, '');

  return result;
}
