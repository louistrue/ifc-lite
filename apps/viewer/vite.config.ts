import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
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
    },
  },
  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      allow: ['../..'],
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@ifc-lite/wasm', 'parquet-wasm'],
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
});
