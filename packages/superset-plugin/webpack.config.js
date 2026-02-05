/**
 * Webpack configuration for .supx (Module Federation) distribution.
 *
 * This builds the plugin as a standalone remote that Superset can load
 * at runtime WITHOUT rebuilding superset-frontend.
 *
 * Usage:
 *   npx webpack --config webpack.config.js
 *
 * Output:
 *   dist-federation/remoteEntry.js  ← load this URL in Superset config
 *
 * Superset config:
 *   DYNAMIC_PLUGINS = {
 *     "ifc_viewer": {
 *       "url": "https://cdn.example.com/ifc-viewer-plugin/remoteEntry.js",
 *       "scope": "ifcViewerPlugin",
 *       "module": "./IfcViewerChartPlugin",
 *     }
 *   }
 */

import { ModuleFederationPlugin } from 'webpack/container.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  mode: 'production',
  entry: './src/bootstrap.ts',
  output: {
    path: path.resolve(__dirname, 'dist-federation'),
    publicPath: 'auto',
    clean: true,
  },
  experiments: {
    asyncWebAssembly: true,
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.wasm'],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript', tsx: true },
              transform: { react: { runtime: 'automatic' } },
              target: 'es2022',
            },
          },
        },
        exclude: /node_modules/,
      },
      {
        test: /\.wasm$/,
        type: 'webassembly/async',
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'ifcViewerPlugin',
      filename: 'remoteEntry.js',
      exposes: {
        './IfcViewerChartPlugin': './src/index.ts',
      },
      shared: {
        react: { singleton: true, requiredVersion: '^18.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
        '@superset-ui/core': { singleton: true },
        '@superset-ui/chart-controls': { singleton: true },
      },
    }),
  ],
  performance: {
    // WASM binaries are large; suppress warnings
    maxAssetSize: 5 * 1024 * 1024,
    maxEntrypointSize: 512 * 1024,
  },
};
