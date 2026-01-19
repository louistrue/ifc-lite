#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATES = {
  basic: 'basic',
  react: 'react',
  server: 'server',
  'server-native': 'server-native',
} as const;

type TemplateType = keyof typeof TEMPLATES;

const REPO_URL = 'https://github.com/louistrue/ifc-lite';
const VIEWER_PATH = 'apps/viewer';

function getLatestVersion(): string {
  try {
    const result = execSync('npm view @ifc-lite/parser version', { stdio: 'pipe' });
    return `^${result.toString().trim()}`;
  } catch {
    return '^1.0.0'; // fallback
  }
}

function printUsage() {
  console.log(`
  create-ifc-lite - Create IFC-Lite projects instantly

  Usage:
    npx create-ifc-lite [project-name] [options]

  Options:
    --template <type>   Template to use [default: basic]
    --help              Show this help message

  Examples:
    npx create-ifc-lite my-ifc-app
    npx create-ifc-lite my-viewer --template react
    npx create-ifc-lite my-backend --template server
    npx create-ifc-lite my-backend --template server-native

  Templates:
    basic          Minimal TypeScript project for parsing IFC files
    react          Full-featured React + Vite viewer with WebGPU rendering
    server         Docker-based IFC processing server with TypeScript client
    server-native  Native binary server (no Docker required)
`);
}

function runCommand(cmd: string, cwd?: string): boolean {
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function downloadViewer(targetDir: string, projectName: string): Promise<boolean> {
  // Try degit first (fastest)
  if (runCommand('npx --version')) {
    console.log('  Downloading viewer template...');
    try {
      execSync(`npx degit ${REPO_URL}/${VIEWER_PATH} "${targetDir}"`, {
        stdio: 'pipe',
        timeout: 60000
      });
      return true;
    } catch {
      // degit failed, try git sparse checkout
    }
  }

  // Fallback: git sparse checkout
  if (runCommand('git --version')) {
    console.log('  Downloading via git...');
    const tempDir = join(dirname(targetDir), `.temp-${Date.now()}`);
    try {
      execSync(`git clone --filter=blob:none --sparse "${REPO_URL}.git" "${tempDir}"`, {
        stdio: 'pipe',
        timeout: 120000
      });
      execSync(`git sparse-checkout set ${VIEWER_PATH}`, { cwd: tempDir, stdio: 'pipe' });

      // Move viewer to target
      const viewerSrc = join(tempDir, VIEWER_PATH);
      execSync(`mv "${viewerSrc}" "${targetDir}"`, { stdio: 'pipe' });
      rmSync(tempDir, { recursive: true, force: true });
      return true;
    } catch {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return false;
}

function fixPackageJson(targetDir: string, projectName: string) {
  const pkgPath = join(targetDir, 'package.json');
  if (!existsSync(pkgPath)) return;

  let pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

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

function fixTsConfig(targetDir: string) {
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

function fixViteConfig(targetDir: string) {
  const viteConfigPath = join(targetDir, 'vite.config.ts');

  // Write standalone vite config with WASM support
  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

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

function fixViewerTemplate(targetDir: string, projectName: string) {
  fixPackageJson(targetDir, projectName);
  fixTsConfig(targetDir);
  fixViteConfig(targetDir);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  // Parse arguments
  let projectName = 'my-ifc-app';
  let template: TemplateType = 'basic';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--template' || arg === '-t') {
      const t = args[++i] as TemplateType;
      if (t && t in TEMPLATES) {
        template = t;
      } else {
        console.error(`Invalid template: ${t}. Available: basic, react, server, server-native`);
        process.exit(1);
      }
    } else if (!arg.startsWith('-')) {
      projectName = arg;
    }
  }

  const targetDir = join(process.cwd(), projectName);

  if (existsSync(targetDir)) {
    console.error(`Directory "${projectName}" already exists.`);
    process.exit(1);
  }

  console.log(`\n  Creating IFC-Lite project in ${targetDir}...\n`);

  if (template === 'react') {
    // Download the actual viewer from GitHub
    const success = await downloadViewer(targetDir, projectName);
    if (success) {
      fixViewerTemplate(targetDir, projectName);
    } else {
      console.error('  Failed to download viewer. Creating minimal fallback...');
      mkdirSync(targetDir, { recursive: true });
      createBasicTemplate(targetDir, projectName);
    }
  } else if (template === 'server') {
    mkdirSync(targetDir, { recursive: true });
    createServerTemplate(targetDir, projectName);
  } else if (template === 'server-native') {
    mkdirSync(targetDir, { recursive: true });
    createServerNativeTemplate(targetDir, projectName);
  } else {
    mkdirSync(targetDir, { recursive: true });
    createBasicTemplate(targetDir, projectName);
  }

  console.log(`  Done! Next steps:\n`);
  console.log(`    cd ${projectName}`);

  if (template === 'server') {
    console.log(`    docker compose up -d`);
    console.log(`    npm install && npm run example`);
    console.log(`\n  Server will be available at http://localhost:3001`);
  } else if (template === 'server-native') {
    console.log(`    npm install`);
    console.log(`    npm run server:start`);
    console.log(`\n  Server will be available at http://localhost:8080`);
  } else {
    console.log(`    npm install`);
    if (template === 'react') {
      console.log(`    npm run dev`);
    } else {
      console.log(`    npm run parse ./your-model.ifc`);
    }
  }
  console.log();
}

function createBasicTemplate(targetDir: string, projectName: string) {
  const latestVersion = getLatestVersion();

  // package.json
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: latestVersion.replace('^', ''),
    type: 'module',
    scripts: {
      parse: 'npx tsx src/index.ts',
      build: 'tsc',
    },
    dependencies: {
      '@ifc-lite/parser': latestVersion,
    },
    devDependencies: {
      typescript: '^5.3.0',
      tsx: '^4.0.0',
    },
  }, null, 2));

  // tsconfig.json
  writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
    },
    include: ['src'],
  }, null, 2));

  // src/index.ts
  mkdirSync(join(targetDir, 'src'));
  writeFileSync(join(targetDir, 'src', 'index.ts'), `import { IfcParser } from '@ifc-lite/parser';
import { readFileSync } from 'fs';

// Example: Parse an IFC file
const ifcPath = process.argv[2];

if (!ifcPath) {
  console.log('Usage: npm run parse <path-to-ifc-file>');
  console.log('');
  console.log('Example:');
  console.log('  npm run parse ./model.ifc');
  process.exit(1);
}

const buffer = readFileSync(ifcPath);
const parser = new IfcParser();

console.log('Parsing IFC file...');
parser.parse(buffer).then(result => {
  console.log('\\nFile parsed successfully!');
  console.log(\`  Entities: \${result.entityCount}\`);

  // Count by type
  const typeCounts = new Map<string, number>();
  for (const [id, entity] of result.entities) {
    typeCounts.set(entity.type, (typeCounts.get(entity.type) || 0) + 1);
  }

  console.log('\\nTop entity types:');
  const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [type, count] of sorted) {
    console.log(\`  \${type}: \${count}\`);
  }
});
`);

  // README
  writeFileSync(join(targetDir, 'README.md'), `# ${projectName}

IFC parser project using [IFC-Lite](https://github.com/louistrue/ifc-lite).

## Quick Start

\`\`\`bash
npm install
npm run parse ./your-model.ifc
\`\`\`

## Learn More

- [IFC-Lite Documentation](https://louistrue.github.io/ifc-lite/)
- [API Reference](https://louistrue.github.io/ifc-lite/api/)
`);
}

function createServerTemplate(targetDir: string, projectName: string) {
  const latestVersion = getLatestVersion();

  // docker-compose.yml - Production configuration
  writeFileSync(join(targetDir, 'docker-compose.yml'), `# IFC-Lite Server - Production Configuration
# Start with: docker compose up -d

services:
  ifc-server:
    image: ghcr.io/louistrue/ifc-lite-server:latest
    container_name: ${projectName}-server
    ports:
      - "\${PORT:-3001}:8080"
    volumes:
      - ifc-cache:/app/cache
    environment:
      - RUST_LOG=\${RUST_LOG:-info}
      - MAX_FILE_SIZE_MB=\${MAX_FILE_SIZE_MB:-500}
      - REQUEST_TIMEOUT_SECS=\${REQUEST_TIMEOUT_SECS:-300}
      - WORKER_THREADS=\${WORKER_THREADS:-4}
      - INITIAL_BATCH_SIZE=\${INITIAL_BATCH_SIZE:-100}
      - MAX_BATCH_SIZE=\${MAX_BATCH_SIZE:-1000}
      - CACHE_MAX_AGE_DAYS=\${CACHE_MAX_AGE_DAYS:-7}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/api/v1/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    restart: unless-stopped

volumes:
  ifc-cache:
    name: ${projectName}-cache
`);

  // docker-compose.dev.yml - Development configuration with live logs
  writeFileSync(join(targetDir, 'docker-compose.dev.yml'), `# IFC-Lite Server - Development Configuration
# Start with: docker compose -f docker-compose.dev.yml up

services:
  ifc-server:
    image: ghcr.io/louistrue/ifc-lite-server:latest
    container_name: ${projectName}-server-dev
    ports:
      - "\${PORT:-3001}:8080"
    volumes:
      - ./cache:/app/cache  # Local cache directory for inspection
    environment:
      - RUST_LOG=debug,tower_http=debug,ifc_lite_server=debug
      - MAX_FILE_SIZE_MB=\${MAX_FILE_SIZE_MB:-500}
      - REQUEST_TIMEOUT_SECS=\${REQUEST_TIMEOUT_SECS:-300}
      - WORKER_THREADS=\${WORKER_THREADS:-4}
      - INITIAL_BATCH_SIZE=\${INITIAL_BATCH_SIZE:-100}
      - MAX_BATCH_SIZE=\${MAX_BATCH_SIZE:-1000}
      - CACHE_MAX_AGE_DAYS=\${CACHE_MAX_AGE_DAYS:-30}
    # No restart in dev - easier to debug
`);

  // .env.example - Documented environment variables
  writeFileSync(join(targetDir, '.env.example'), `# IFC-Lite Server Configuration
# Copy this file to .env and modify as needed

# =============================================================================
# SERVER SETTINGS
# =============================================================================

# Port to expose the server on (maps to internal port 8080)
PORT=3001

# Log level: error, warn, info, debug, trace
# Use "debug" for development, "info" for production
RUST_LOG=info

# =============================================================================
# FILE PROCESSING
# =============================================================================

# Maximum IFC file size in megabytes
# Larger files need more memory and processing time
MAX_FILE_SIZE_MB=500

# Request timeout in seconds
# Increase for very large files (500MB+)
REQUEST_TIMEOUT_SECS=300

# Number of worker threads for parallel geometry processing
# Default: number of CPU cores
# Reduce if running alongside other services
WORKER_THREADS=4

# =============================================================================
# STREAMING (Progressive Rendering)
# =============================================================================

# Initial batch size for fast first frame (first 3 batches)
# Smaller = faster first render, but more HTTP overhead
INITIAL_BATCH_SIZE=100

# Maximum batch size for throughput (batches 11+)
# Larger = better throughput, but longer waits between updates
MAX_BATCH_SIZE=1000

# =============================================================================
# CACHING
# =============================================================================

# How long to keep cached results (in days)
# Cached files are served instantly without reprocessing
CACHE_MAX_AGE_DAYS=7
`);

  // Copy .env.example to .env
  writeFileSync(join(targetDir, '.env'), `# IFC-Lite Server Configuration
# See .env.example for all available options with documentation

PORT=3001
RUST_LOG=info
MAX_FILE_SIZE_MB=500
WORKER_THREADS=4
`);

  // .gitignore
  writeFileSync(join(targetDir, '.gitignore'), `# Dependencies
node_modules/

# Build output
dist/

# Environment files (keep .env.example)
.env
.env.local
.env.*.local

# Cache directory (when using dev compose)
cache/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
`);

  // .dockerignore
  writeFileSync(join(targetDir, '.dockerignore'), `node_modules
dist
.git
.gitignore
*.md
.env
.env.*
cache
`);

  // package.json
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '0.1.0',
    type: 'module',
    description: 'IFC processing server with TypeScript client',
    scripts: {
      'example': 'npx tsx src/example.ts',
      'example:stream': 'npx tsx src/example-stream.ts',
      'server:start': 'docker compose up -d',
      'server:stop': 'docker compose down',
      'server:logs': 'docker compose logs -f',
      'server:dev': 'docker compose -f docker-compose.dev.yml up',
      'build': 'tsc',
      'typecheck': 'tsc --noEmit',
    },
    dependencies: {
      '@ifc-lite/server-client': latestVersion,
    },
    devDependencies: {
      'typescript': '^5.3.0',
      'tsx': '^4.0.0',
      '@types/node': '^20.0.0',
    },
    optionalDependencies: {
      'parquet-wasm': '^0.6.0',
      'apache-arrow': '^17.0.0',
    },
  }, null, 2));

  // tsconfig.json
  writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
      declaration: true,
      lib: ['ES2022'],
    },
    include: ['src'],
    exclude: ['node_modules', 'dist'],
  }, null, 2));

  // Create src directory
  mkdirSync(join(targetDir, 'src'));

  // src/example.ts - Basic client example
  writeFileSync(join(targetDir, 'src', 'example.ts'), `/**
 * IFC-Lite Server Client Example
 *
 * This example demonstrates how to use the IFC-Lite server to parse IFC files.
 * The server handles heavy geometry processing, caching, and streaming.
 *
 * Prerequisites:
 *   1. Start the server: docker compose up -d
 *   2. Run this example: npm run example
 */

import { IfcServerClient } from '@ifc-lite/server-client';
import { readFileSync, existsSync } from 'fs';

// Server URL - matches docker-compose.yml port mapping
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

async function main() {
  // Initialize client
  const client = new IfcServerClient({
    baseUrl: SERVER_URL,
    timeout: 300000, // 5 minutes for large files
  });

  // Check server health
  console.log('Checking server health...');
  try {
    const health = await client.health();
    console.log(\`Server status: \${health.status}\`);
    console.log(\`Server version: \${health.version || 'unknown'}\`);
  } catch (error) {
    console.error('Failed to connect to server. Is it running?');
    console.error('Start it with: docker compose up -d');
    process.exit(1);
  }

  // Get IFC file path from command line or use default
  const ifcPath = process.argv[2];

  if (!ifcPath) {
    console.log(\`
Usage: npm run example <path-to-ifc-file>

Example:
  npm run example ./model.ifc

The server will:
  1. Check if the file is already cached (instant response)
  2. If not cached, parse and process geometry
  3. Cache the result for future requests
  4. Return geometry data ready for rendering
\`);
    return;
  }

  if (!existsSync(ifcPath)) {
    console.error(\`File not found: \${ifcPath}\`);
    process.exit(1);
  }

  // Read IFC file
  console.log(\`\\nParsing: \${ifcPath}\`);
  const buffer = readFileSync(ifcPath);
  console.log(\`File size: \${(buffer.length / 1024 / 1024).toFixed(2)} MB\`);

  // Parse with Parquet format (most efficient)
  console.log('\\nSending to server...');
  const startTime = performance.now();

  try {
    // Check if Parquet is available (optional dependency)
    const parquetAvailable = await client.isParquetSupported();

    if (parquetAvailable) {
      console.log('Using Parquet format (15x smaller than JSON)');
      const result = await client.parseParquet(buffer);

      const elapsed = performance.now() - startTime;
      console.log(\`\\nParsing complete in \${elapsed.toFixed(0)}ms\`);
      console.log(\`  Cache key: \${result.cache_key.substring(0, 16)}...\`);
      console.log(\`  Meshes: \${result.meshes.length}\`);
      console.log(\`  Payload size: \${(result.parquet_stats.payload_size / 1024).toFixed(1)} KB\`);
      console.log(\`  Decode time: \${result.parquet_stats.decode_time_ms}ms\`);

      if (result.stats) {
        console.log(\`\\nServer stats:\`);
        console.log(\`  Parse time: \${result.stats.parse_time_ms}ms\`);
        console.log(\`  Geometry time: \${result.stats.geometry_time_ms}ms\`);
        console.log(\`  Total triangles: \${result.stats.total_triangles}\`);
      }

      // Show sample mesh data
      if (result.meshes.length > 0) {
        const mesh = result.meshes[0];
        console.log(\`\\nSample mesh:\`);
        console.log(\`  Express ID: \${mesh.express_id}\`);
        console.log(\`  Vertices: \${mesh.positions.length / 3}\`);
        console.log(\`  Triangles: \${mesh.indices.length / 3}\`);
        console.log(\`  Color: rgba(\${mesh.color.join(', ')})\`);
      }
    } else {
      // Fallback to JSON format
      console.log('Parquet not available, using JSON format');
      console.log('Install optional deps for smaller payloads: npm install parquet-wasm apache-arrow');

      const result = await client.parse(buffer);

      const elapsed = performance.now() - startTime;
      console.log(\`\\nParsing complete in \${elapsed.toFixed(0)}ms\`);
      console.log(\`  Cache key: \${result.cache_key.substring(0, 16)}...\`);
      console.log(\`  Meshes: \${result.meshes.length}\`);
    }
  } catch (error) {
    console.error('Parse failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
`);

  // src/example-stream.ts - Streaming example for large files
  writeFileSync(join(targetDir, 'src', 'example-stream.ts'), `/**
 * IFC-Lite Server Streaming Example
 *
 * This example demonstrates streaming parsing for large IFC files.
 * Geometry batches are received progressively, enabling immediate rendering
 * while the server continues processing.
 *
 * Best for: Files > 50MB where you want progressive rendering
 *
 * Prerequisites:
 *   1. Start the server: docker compose up -d
 *   2. Install optional deps: npm install parquet-wasm apache-arrow
 *   3. Run: npm run example:stream <path-to-ifc>
 */

import { IfcServerClient } from '@ifc-lite/server-client';
import { readFileSync, existsSync } from 'fs';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

async function main() {
  const client = new IfcServerClient({
    baseUrl: SERVER_URL,
    timeout: 600000, // 10 minutes for very large files
  });

  // Check server
  try {
    await client.health();
    console.log('Server connected');
  } catch {
    console.error('Server not available. Start with: docker compose up -d');
    process.exit(1);
  }

  const ifcPath = process.argv[2];
  if (!ifcPath || !existsSync(ifcPath)) {
    console.log('Usage: npm run example:stream <path-to-ifc-file>');
    process.exit(1);
  }

  const buffer = readFileSync(ifcPath);
  console.log(\`\\nStreaming: \${ifcPath} (\${(buffer.length / 1024 / 1024).toFixed(1)} MB)\`);

  // Check Parquet support
  const parquetAvailable = await client.isParquetSupported();
  if (!parquetAvailable) {
    console.error('Streaming requires parquet-wasm and apache-arrow.');
    console.error('Install with: npm install parquet-wasm apache-arrow');
    process.exit(1);
  }

  const startTime = performance.now();
  let totalMeshes = 0;
  let batchCount = 0;

  try {
    // Stream with batch callback
    const result = await client.parseParquetStream(buffer, (batch) => {
      batchCount++;
      totalMeshes += batch.meshes.length;

      // In a real app, you would render each batch immediately
      console.log(
        \`  Batch #\${batch.batch_number}: +\${batch.meshes.length} meshes \` +
        \`(decode: \${batch.decode_time_ms.toFixed(0)}ms) - Total: \${totalMeshes}\`
      );
    });

    const elapsed = performance.now() - startTime;
    console.log(\`\\nStreaming complete!\`);
    console.log(\`  Total time: \${elapsed.toFixed(0)}ms\`);
    console.log(\`  Batches received: \${batchCount}\`);
    console.log(\`  Total meshes: \${result.total_meshes}\`);
    console.log(\`  Cache key: \${result.cache_key.substring(0, 16)}...\`);

    if (result.stats) {
      console.log(\`\\nServer processing:\`);
      console.log(\`  Parse: \${result.stats.parse_time_ms}ms\`);
      console.log(\`  Geometry: \${result.stats.geometry_time_ms}ms\`);
      console.log(\`  Triangles: \${result.stats.total_triangles}\`);
    }

    // Optionally fetch full data model for properties panel
    console.log(\`\\nFetching data model for properties...\`);
    const dataModel = await client.fetchDataModel(result.cache_key);
    if (dataModel) {
      console.log(\`  Data model size: \${(dataModel.byteLength / 1024).toFixed(1)} KB\`);
    }

  } catch (error) {
    console.error('Streaming failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
`);

  // src/index.ts - Library re-export for custom integrations
  writeFileSync(join(targetDir, 'src', 'index.ts'), `/**
 * ${projectName} - IFC Processing Server Client
 *
 * Re-exports the IFC-Lite server client for custom integrations.
 * See example.ts and example-stream.ts for usage examples.
 */

export { IfcServerClient } from '@ifc-lite/server-client';
export type {
  ServerConfig,
  ParseResponse,
  ParquetParseResponse,
  StreamEvent,
  HealthResponse,
  MetadataResponse,
} from '@ifc-lite/server-client';

// Default server URL
export const DEFAULT_SERVER_URL = 'http://localhost:3001';

/**
 * Create a pre-configured client for the local Docker server.
 */
export function createLocalClient(options?: { timeout?: number }) {
  const { IfcServerClient } = require('@ifc-lite/server-client');
  return new IfcServerClient({
    baseUrl: process.env.SERVER_URL || DEFAULT_SERVER_URL,
    timeout: options?.timeout ?? 300000,
  });
}
`);

  // README.md
  writeFileSync(join(targetDir, 'README.md'), `# ${projectName}

IFC processing server using [IFC-Lite](https://github.com/louistrue/ifc-lite).

## Quick Start

\`\`\`bash
# 1. Start the server
docker compose up -d

# 2. Install client dependencies
npm install

# 3. Run the example (replace with your IFC file)
npm run example ./your-model.ifc
\`\`\`

## Features

| Feature | Description |
|---------|-------------|
| **Content-Addressable Cache** | Same file = instant response (no reprocessing) |
| **Parquet Format** | 15x smaller payloads than JSON |
| **Streaming** | Progressive geometry for large files |
| **Parallel Processing** | Multi-threaded geometry processing |

## Architecture

\`\`\`
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Your App       │────▶│  IFC-Lite Server │────▶│  Cache      │
│  (TypeScript)   │◀────│  (Docker)        │◀────│  (Volume)   │
└─────────────────┘     └──────────────────┘     └─────────────┘
\`\`\`

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run example\` | Basic parsing example |
| \`npm run example:stream\` | Streaming example for large files |
| \`npm run server:start\` | Start server in background |
| \`npm run server:stop\` | Stop server |
| \`npm run server:logs\` | View server logs |
| \`npm run server:dev\` | Start with debug logging |

## Configuration

Copy \`.env.example\` to \`.env\` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| \`PORT\` | 3001 | Server port |
| \`MAX_FILE_SIZE_MB\` | 500 | Max upload size |
| \`WORKER_THREADS\` | 4 | Parallel processing threads |
| \`CACHE_MAX_AGE_DAYS\` | 7 | Cache retention |

See \`.env.example\` for all options with documentation.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| \`GET /api/v1/health\` | Health check |
| \`POST /api/v1/parse\` | Full parse (JSON response) |
| \`POST /api/v1/parse/parquet\` | Full parse (Parquet, 15x smaller) |
| \`POST /api/v1/parse/parquet-stream\` | Streaming parse (SSE + Parquet) |
| \`GET /api/v1/cache/check/:hash\` | Check if file is cached |

## Client Usage

### Basic Parse

\`\`\`typescript
import { IfcServerClient } from '@ifc-lite/server-client';

const client = new IfcServerClient({
  baseUrl: 'http://localhost:3001'
});

const result = await client.parseParquet(ifcBuffer);
console.log(\`Meshes: \${result.meshes.length}\`);
\`\`\`

### Streaming (Large Files)

\`\`\`typescript
await client.parseParquetStream(ifcBuffer, (batch) => {
  // Render each batch immediately
  for (const mesh of batch.meshes) {
    scene.addMesh(mesh);
  }
});
\`\`\`

### Cache-First Pattern

\`\`\`typescript
// Client automatically:
// 1. Computes file hash locally
// 2. Checks server cache
// 3. Skips upload if cached (instant response!)
const result = await client.parseParquet(ifcBuffer);
\`\`\`

## Production Deployment

### Railway / Render / Fly.io

The Docker image works on any container platform:

\`\`\`bash
# Pull and run
docker pull ghcr.io/louistrue/ifc-lite-server:latest
docker run -p 8080:8080 -v ifc-cache:/app/cache ghcr.io/louistrue/ifc-lite-server
\`\`\`

### Environment Variables

Set these in your deployment platform:

\`\`\`
PORT=8080
MAX_FILE_SIZE_MB=500
WORKER_THREADS=4
CACHE_MAX_AGE_DAYS=30
RUST_LOG=info
\`\`\`

## Learn More

- [IFC-Lite Documentation](https://louistrue.github.io/ifc-lite/)
- [Server API Reference](https://louistrue.github.io/ifc-lite/api/server/)
- [GitHub Repository](https://github.com/louistrue/ifc-lite)
`);

  console.log('  Created docker-compose.yml');
  console.log('  Created docker-compose.dev.yml');
  console.log('  Created .env.example');
  console.log('  Created .env');
  console.log('  Created package.json');
  console.log('  Created tsconfig.json');
  console.log('  Created src/example.ts');
  console.log('  Created src/example-stream.ts');
  console.log('  Created src/index.ts');
  console.log('  Created README.md');
  console.log('  Created .gitignore');
  console.log('  Created .dockerignore');
}

function createServerNativeTemplate(targetDir: string, projectName: string) {
  const latestVersion = getLatestVersion();

  // package.json
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '0.1.0',
    type: 'module',
    description: 'IFC processing server (native binary) with TypeScript client',
    scripts: {
      'server:start': 'npx @ifc-lite/server-bin',
      'server:download': 'npx @ifc-lite/server-bin download',
      'server:info': 'npx @ifc-lite/server-bin info',
      'example': 'npx tsx src/example.ts',
      'example:stream': 'npx tsx src/example-stream.ts',
      'build': 'tsc',
      'typecheck': 'tsc --noEmit',
    },
    dependencies: {
      '@ifc-lite/server-bin': latestVersion,
      '@ifc-lite/server-client': latestVersion,
    },
    devDependencies: {
      'typescript': '^5.3.0',
      'tsx': '^4.0.0',
      '@types/node': '^20.0.0',
    },
    optionalDependencies: {
      'parquet-wasm': '^0.6.0',
      'apache-arrow': '^17.0.0',
    },
  }, null, 2));

  // tsconfig.json
  writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: 'dist',
      declaration: true,
      lib: ['ES2022'],
    },
    include: ['src'],
    exclude: ['node_modules', 'dist'],
  }, null, 2));

  // .env.example
  writeFileSync(join(targetDir, '.env.example'), `# IFC-Lite Server Configuration (Native Binary)
# These environment variables configure the server

# =============================================================================
# SERVER SETTINGS
# =============================================================================

# Server port
PORT=8080

# Log level: error, warn, info, debug, trace
RUST_LOG=info

# =============================================================================
# FILE PROCESSING
# =============================================================================

# Maximum IFC file size in megabytes
MAX_FILE_SIZE_MB=500

# Request timeout in seconds
REQUEST_TIMEOUT_SECS=300

# Number of worker threads for parallel processing
# Default: number of CPU cores
WORKER_THREADS=4

# =============================================================================
# STREAMING
# =============================================================================

# Initial batch size for fast first frame
INITIAL_BATCH_SIZE=100

# Maximum batch size for throughput
MAX_BATCH_SIZE=1000

# =============================================================================
# CACHING
# =============================================================================

# Cache directory (relative or absolute path)
CACHE_DIR=./.cache

# Cache retention in days
CACHE_MAX_AGE_DAYS=7
`);

  // .gitignore
  writeFileSync(join(targetDir, '.gitignore'), `# Dependencies
node_modules/

# Build output
dist/

# Environment files
.env
.env.local
.env.*.local

# Cache directory
.cache/

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
`);

  // Create src directory
  mkdirSync(join(targetDir, 'src'));

  // src/example.ts
  writeFileSync(join(targetDir, 'src', 'example.ts'), `/**
 * IFC-Lite Native Server Example
 *
 * This example demonstrates using the IFC-Lite server with native binary.
 * No Docker required - the binary is downloaded and run automatically.
 *
 * Usage:
 *   1. Start the server: npm run server:start
 *   2. In another terminal: npm run example ./your-model.ifc
 */

import { IfcServerClient } from '@ifc-lite/server-client';
import { readFileSync, existsSync } from 'fs';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';

async function main() {
  const client = new IfcServerClient({
    baseUrl: SERVER_URL,
    timeout: 300000,
  });

  // Check server
  console.log('Checking server health...');
  try {
    const health = await client.health();
    console.log(\`Server status: \${health.status}\`);
  } catch (error) {
    console.error('Failed to connect to server.');
    console.error('Start it with: npm run server:start');
    process.exit(1);
  }

  const ifcPath = process.argv[2];
  if (!ifcPath) {
    console.log(\`
Usage: npm run example <path-to-ifc-file>

Example:
  npm run example ./model.ifc
\`);
    return;
  }

  if (!existsSync(ifcPath)) {
    console.error(\`File not found: \${ifcPath}\`);
    process.exit(1);
  }

  const buffer = readFileSync(ifcPath);
  console.log(\`\\nParsing: \${ifcPath}\`);
  console.log(\`File size: \${(buffer.length / 1024 / 1024).toFixed(2)} MB\`);

  const startTime = performance.now();

  try {
    const parquetAvailable = await client.isParquetSupported();

    if (parquetAvailable) {
      console.log('Using Parquet format (15x smaller)');
      const result = await client.parseParquet(buffer);
      const elapsed = performance.now() - startTime;

      console.log(\`\\nComplete in \${elapsed.toFixed(0)}ms\`);
      console.log(\`  Meshes: \${result.meshes.length}\`);
      console.log(\`  Payload: \${(result.parquet_stats.payload_size / 1024).toFixed(1)} KB\`);

      if (result.stats) {
        console.log(\`  Triangles: \${result.stats.total_triangles}\`);
      }
    } else {
      console.log('Using JSON format');
      const result = await client.parse(buffer);
      const elapsed = performance.now() - startTime;

      console.log(\`\\nComplete in \${elapsed.toFixed(0)}ms\`);
      console.log(\`  Meshes: \${result.meshes.length}\`);
    }
  } catch (error) {
    console.error('Parse failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
`);

  // src/example-stream.ts
  writeFileSync(join(targetDir, 'src', 'example-stream.ts'), `/**
 * IFC-Lite Native Server Streaming Example
 *
 * For large files (>50MB) - geometry arrives in batches.
 *
 * Usage:
 *   1. Start the server: npm run server:start
 *   2. In another terminal: npm run example:stream ./large-model.ifc
 */

import { IfcServerClient } from '@ifc-lite/server-client';
import { readFileSync, existsSync } from 'fs';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';

async function main() {
  const client = new IfcServerClient({
    baseUrl: SERVER_URL,
    timeout: 600000,
  });

  try {
    await client.health();
    console.log('Server connected');
  } catch {
    console.error('Server not available. Start with: npm run server:start');
    process.exit(1);
  }

  const ifcPath = process.argv[2];
  if (!ifcPath || !existsSync(ifcPath)) {
    console.log('Usage: npm run example:stream <path-to-ifc-file>');
    process.exit(1);
  }

  const parquetAvailable = await client.isParquetSupported();
  if (!parquetAvailable) {
    console.error('Streaming requires parquet-wasm and apache-arrow.');
    console.error('Install with: npm install parquet-wasm apache-arrow');
    process.exit(1);
  }

  const buffer = readFileSync(ifcPath);
  console.log(\`\\nStreaming: \${ifcPath} (\${(buffer.length / 1024 / 1024).toFixed(1)} MB)\`);

  const startTime = performance.now();
  let totalMeshes = 0;

  try {
    const result = await client.parseParquetStream(buffer, (batch) => {
      totalMeshes += batch.meshes.length;
      console.log(\`  Batch #\${batch.batch_number}: +\${batch.meshes.length} meshes (total: \${totalMeshes})\`);
    });

    const elapsed = performance.now() - startTime;
    console.log(\`\\nComplete in \${elapsed.toFixed(0)}ms\`);
    console.log(\`  Total meshes: \${result.total_meshes}\`);

  } catch (error) {
    console.error('Streaming failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
`);

  // src/index.ts
  writeFileSync(join(targetDir, 'src', 'index.ts'), `/**
 * ${projectName} - IFC Processing Server (Native Binary)
 *
 * Re-exports for custom integrations.
 */

export { IfcServerClient } from '@ifc-lite/server-client';
export type {
  ServerConfig,
  ParseResponse,
  ParquetParseResponse,
  StreamEvent,
  HealthResponse,
  MetadataResponse,
} from '@ifc-lite/server-client';

export const DEFAULT_SERVER_URL = 'http://localhost:8080';
`);

  // README.md
  writeFileSync(join(targetDir, 'README.md'), `# ${projectName}

IFC processing server using native binary - no Docker required.

## Quick Start

\`\`\`bash
# Install dependencies (downloads server binary automatically)
npm install

# Start the server
npm run server:start

# In another terminal, run the example
npm run example ./your-model.ifc
\`\`\`

## Features

| Feature | Description |
|---------|-------------|
| **No Docker Required** | Native binary runs directly |
| **Auto-Download** | Binary downloaded on first run |
| **Cross-Platform** | macOS, Linux, Windows support |
| **Content-Addressable Cache** | Same file = instant response |

## Scripts

| Command | Description |
|---------|-------------|
| \`npm run server:start\` | Start the IFC-Lite server |
| \`npm run server:download\` | Download binary without starting |
| \`npm run server:info\` | Show platform and binary info |
| \`npm run example\` | Basic parsing example |
| \`npm run example:stream\` | Streaming example for large files |

## Configuration

Set environment variables to configure the server:

\`\`\`bash
# Custom port
PORT=3001 npm run server:start

# Debug logging
RUST_LOG=debug npm run server:start

# Multiple options
PORT=3001 WORKER_THREADS=8 npm run server:start
\`\`\`

See \`.env.example\` for all options.

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| \`GET /api/v1/health\` | Health check |
| \`POST /api/v1/parse\` | Full parse (JSON) |
| \`POST /api/v1/parse/parquet\` | Full parse (Parquet, 15x smaller) |
| \`POST /api/v1/parse/parquet-stream\` | Streaming parse |
| \`GET /api/v1/cache/check/:hash\` | Check cache |

## Supported Platforms

| Platform | Architecture | Status |
|----------|--------------|--------|
| macOS | Intel (x64) | ✅ |
| macOS | Apple Silicon (arm64) | ✅ |
| Linux | x64 | ✅ |
| Linux | arm64 | ✅ |
| Windows | x64 | ✅ |

## Alternatives

If native binaries don't work for your platform:

\`\`\`bash
# Use Docker instead
npx create-ifc-lite my-app --template server
\`\`\`

## Learn More

- [IFC-Lite Documentation](https://louistrue.github.io/ifc-lite/)
- [GitHub Repository](https://github.com/louistrue/ifc-lite)
`);

  console.log('  Created package.json');
  console.log('  Created tsconfig.json');
  console.log('  Created .env.example');
  console.log('  Created .gitignore');
  console.log('  Created src/example.ts');
  console.log('  Created src/example-stream.ts');
  console.log('  Created src/index.ts');
  console.log('  Created README.md');
}

main().catch(console.error);
