import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 3000,
        open: true,
        // Note: Removed COOP/COEP headers to force web-ifc single-threaded mode
        // SharedArrayBuffer won't be available, but web-ifc will work correctly
    },
    build: {
        target: 'esnext',
    },
    optimizeDeps: {
        exclude: ['web-ifc'],
    },
    assetsInclude: ['**/*.wasm'],
});
