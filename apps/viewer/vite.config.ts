import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

// Path to the WASM package - using public folder for static serving (no transforms)
const wasmPkgPath = path.resolve(__dirname, '../../packages/wasm/pkg/ifc-lite.js');
// Public folder path for workers to use (served statically)
const wasmPublicPath = '/wasm/ifc-lite.js';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
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
    // Fix wasm-bindgen-rayon worker imports in dev mode
    // The workerHelpers.js does `import('../../..')` which doesn't resolve correctly in Vite dev
    {
      name: 'wasm-rayon-worker-fix',
      enforce: 'pre', // Run before other transforms
      transform(code, id) {
        // Only transform the workerHelpers.js file
        if (id.includes('wasm-bindgen-rayon') && id.includes('workerHelpers')) {
          // Replace the relative import with the absolute path to the WASM package
          const fixedPath = wasmPkgPath.replace(/\\/g, '/');
          // Use a simpler string replacement
          const transformed = code
            .replace("import('../../..')", `import('${fixedPath}')`)
            .replace('import("../../..")', `import("${fixedPath}")`);
          console.log('[wasm-rayon-worker-fix] Transform applied:', code !== transformed);
          if (code !== transformed) {
            console.log('[wasm-rayon-worker-fix] Transformed to use:', fixedPath);
          }
          return transformed;
        }
        // Skip transforms on WASM package JS files to preserve their exact behavior
        if (id.includes('/packages/wasm/pkg/') && id.endsWith('.js')) {
          return {
            code,
            map: null,
          };
        }
        return code;
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ifc-lite/parser': path.resolve(__dirname, '../../packages/parser/src'),
      '@ifc-lite/geometry': path.resolve(__dirname, '../../packages/geometry/src'),
      '@ifc-lite/renderer': path.resolve(__dirname, '../../packages/renderer/src'),
      '@ifc-lite/query': path.resolve(__dirname, '../../packages/query/src'),
      '@ifc-lite/server-client': path.resolve(__dirname, '../../packages/server-client/src'),
      '@ifc-lite/spatial': path.resolve(__dirname, '../../packages/spatial/src'),
      '@ifc-lite/data': path.resolve(__dirname, '../../packages/data/src'),
      '@ifc-lite/export': path.resolve(__dirname, '../../packages/export/src'),
      '@ifc-lite/cache': path.resolve(__dirname, '../../packages/cache/src'),
      '@ifc-lite/wasm': path.resolve(__dirname, '../../packages/wasm/pkg/ifc-lite.js'),
      'parquet-wasm': path.resolve(__dirname, 'node_modules/parquet-wasm'),
    },
  },
  server: {
    port: 3000,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    hmr: {
      overlay: true,
    },
    watch: {
      usePolling: false,
      ignored: ['**/node_modules/**', '**/dist/**', '**/target/**', '**/pkg/**'],
    },
    // Allow serving files from the entire workspace for WASM worker imports
    fs: {
      strict: false,
      allow: [
        // Allow the WASM package directory
        path.resolve(__dirname, '../../packages/wasm/pkg'),
        // Allow the project root
        path.resolve(__dirname, '../..'),
      ],
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: [
      '@duckdb/duckdb-wasm', // Optional dependency, exclude from pre-bundling
      'parquet-wasm', // Has WASM files that shouldn't be pre-bundled
      '@ifc-lite/wasm', // Don't pre-bundle WASM to preserve worker imports
    ],
  },
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
    plugins: () => [
      wasm(),
      topLevelAwait(),
      react(),
      // Resolve aliases in worker context
      {
        name: 'worker-alias-resolver',
        resolveId(id) {
          if (id.startsWith('@ifc-lite/')) {
            const packageName = id.split('/')[1];
            // WASM package doesn't have src folder - use pkg
            if (packageName === 'wasm') {
              return path.resolve(__dirname, `../../packages/wasm/pkg/ifc-lite.js`);
            }
            return path.resolve(__dirname, `../../packages/${packageName}/src`);
          }
        },
      },
    ],
  },
});
