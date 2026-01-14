import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ifc-lite/parser': path.resolve(__dirname, '../../packages/parser/src'),
      '@ifc-lite/geometry': path.resolve(__dirname, '../../packages/geometry/src'),
      '@ifc-lite/renderer': path.resolve(__dirname, '../../packages/renderer/src'),
      '@ifc-lite/query': path.resolve(__dirname, '../../packages/query/src'),
      '@ifc-lite/spatial': path.resolve(__dirname, '../../packages/spatial/src'),
      '@ifc-lite/data': path.resolve(__dirname, '../../packages/data/src'),
      '@ifc-lite/export': path.resolve(__dirname, '../../packages/export/src'),
      '@ifc-lite/wasm': path.resolve(__dirname, '../../packages/wasm/pkg/ifc-lite.js'),
    },
  },
  server: {
    port: 3000,
    open: true,
    hmr: {
      overlay: true,
    },
    watch: {
      usePolling: false,
      ignored: ['**/node_modules/**', '**/dist/**', '**/target/**', '**/pkg/**'],
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'], // Optional dependency, exclude from pre-bundling
  },
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
    plugins: () => [
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
