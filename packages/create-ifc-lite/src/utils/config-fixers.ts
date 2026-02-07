/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

/**
 * Fetch the latest published version of @ifc-lite/parser from npm.
 * Falls back to '^1.0.0' when the registry is unreachable.
 */
export function getLatestVersion(): string {
  try {
    const result = execSync('npm view @ifc-lite/parser version', { stdio: 'pipe' });
    return `^${result.toString().trim()}`;
  } catch {
    return '^1.0.0'; // fallback
  }
}

/**
 * Rewrite the viewer's package.json so it works as a standalone project:
 *   - Set the project name
 *   - Replace workspace: protocol versions with the latest npm version
 *   - Remove the .git directory if present
 */
export function fixPackageJson(targetDir: string, projectName: string) {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

  // Update name
  pkg.name = projectName;

  // Replace workspace protocol with latest npm version in all dependency fields
  const latestVersion = getLatestVersion();
  const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

  for (const field of depFields) {
    const deps = pkg[field];
    if (!deps) continue;

    for (const [name, version] of Object.entries(deps)) {
      if (typeof version === 'string' && version.includes('workspace:')) {
        deps[name] = latestVersion;
      }
    }
  }

  // Remove git directory if present
  const gitDir = join(targetDir, '.git');
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true, force: true });
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
}

/**
 * Write a standalone tsconfig.json without monorepo references.
 */
export function fixTsConfig(targetDir: string) {
  const tsconfigPath = join(targetDir, 'tsconfig.json');

  // Write standalone tsconfig without monorepo references
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*']
      }
    },
    include: ['src/**/*'],
    exclude: ['node_modules']
  };

  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
}

/**
 * Write a standalone vite.config.ts with WASM support.
 */
export function fixViteConfig(targetDir: string) {
  const viteConfigPath = join(targetDir, 'vite.config.ts');

  // Write standalone vite config with WASM support
  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'wasm-mime-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __RELEASE_HISTORY__: JSON.stringify([]),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@ifc-lite/wasm'],
  },
  assetsInclude: ['**/*.wasm'],
});
`;

  writeFileSync(viteConfigPath, viteConfig);
}

/**
 * Apply all viewer-template fixups: package.json, tsconfig, vite config.
 */
export function fixViewerTemplate(targetDir: string, projectName: string) {
  fixPackageJson(targetDir, projectName);
  fixTsConfig(targetDir);
  fixViteConfig(targetDir);
}
