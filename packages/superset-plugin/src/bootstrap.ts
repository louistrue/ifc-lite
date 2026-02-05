/**
 * Async boundary for Module Federation.
 *
 * WASM modules require an async boundary at the entry point when using
 * Webpack Module Federation. This file serves as that boundary —
 * it dynamically imports the real entry point so that WASM can be
 * loaded asynchronously before any code that depends on it executes.
 *
 * See: https://webpack.js.org/concepts/module-federation/#troubleshooting
 */
import('./index.js');
