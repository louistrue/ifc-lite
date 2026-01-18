import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

// Path to the WASM package
const wasmPkgPath = path.resolve(__dirname, '../../packages/wasm/pkg');

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    // Copy WASM files to dist/wasm for production - enables proper worker loading
    viteStaticCopy({
      targets: [
        {
          src: `${wasmPkgPath}/ifc-lite.js`,
          dest: 'wasm',
        },
        {
          src: `${wasmPkgPath}/ifc-lite_bg.wasm`,
          dest: 'wasm',
        },
      ],
    }),
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
    fs: {
      strict: false,
      allow: [
        path.resolve(__dirname, '../../packages/wasm/pkg'),
        path.resolve(__dirname, '../..'),
      ],
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      // Don't bundle the worker's dynamic import of WASM - it's served statically
      external: (id) => id === '/wasm/ifc-lite.js',
    },
  },
  optimizeDeps: {
    exclude: [
      '@duckdb/duckdb-wasm',
      'parquet-wasm',
      '@ifc-lite/wasm',
    ],
  },
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
    plugins: () => [
      wasm(),
      topLevelAwait(),
      react(),
      {
        name: 'worker-alias-resolver',
        resolveId(id) {
          if (id.startsWith('@ifc-lite/')) {
            const packageName = id.split('/')[1];
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
