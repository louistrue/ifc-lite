import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
// Tauri expects a fixed port, fail if that port is not available
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point to viewer's source for shared components
      '@': path.resolve(__dirname, '../viewer/src'),
      '@ifc-lite/parser': path.resolve(__dirname, '../../packages/parser/src'),
      '@ifc-lite/geometry': path.resolve(__dirname, '../../packages/geometry/src'),
      '@ifc-lite/renderer': path.resolve(__dirname, '../../packages/renderer/src'),
      '@ifc-lite/query': path.resolve(__dirname, '../../packages/query/src'),
      '@ifc-lite/spatial': path.resolve(__dirname, '../../packages/spatial/src'),
      '@ifc-lite/data': path.resolve(__dirname, '../../packages/data/src'),
      '@ifc-lite/export': path.resolve(__dirname, '../../packages/export/src'),
      '@ifc-lite/cache': path.resolve(__dirname, '../../packages/cache/src'),
      '@ifc-lite/ifcx': path.resolve(__dirname, '../../packages/ifcx/src'),
      '@ifc-lite/wasm': path.resolve(__dirname, '../../packages/wasm/pkg/ifc-lite.js'),
    },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 3001,
    strictPort: true,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  // 3. to access the Tauri environment variables set by the CLI with information about the current target
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome113' : 'safari15',
    // don't minify for debug builds
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  worker: {
    format: 'es',
    plugins: () => [
      react(),
      {
        name: 'worker-alias-resolver',
        resolveId(id) {
          if (id.startsWith('@ifc-lite/')) {
            const packageName = id.split('/')[1];
            if (packageName === 'wasm') {
              return path.resolve(__dirname, '../../packages/wasm/pkg/ifc-lite.js');
            }
            return path.resolve(__dirname, `../../packages/${packageName}/src`);
          }
        },
      },
    ],
  },
});
