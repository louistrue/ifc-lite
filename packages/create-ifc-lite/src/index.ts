#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATES = {
  basic: 'basic',
  react: 'react',
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
    --template <type>   Template to use (basic, react) [default: basic]
    --help              Show this help message

  Examples:
    npx create-ifc-lite my-ifc-app
    npx create-ifc-lite my-viewer --template react

  Templates:
    basic   Minimal TypeScript project for parsing IFC files
    react   Full-featured React + Vite viewer with WebGPU rendering
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

  // Replace workspace:* with latest npm version
  const latestVersion = getLatestVersion();
  const deps = pkg.dependencies || {};
  for (const [name, version] of Object.entries(deps)) {
    if (version === 'workspace:*' && name.startsWith('@ifc-lite/')) {
      deps[name] = latestVersion;
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

  // Write standalone vite config - packages resolve from node_modules
  const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm'],
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
        console.error(`Invalid template: ${t}. Available: basic, react`);
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
  } else {
    mkdirSync(targetDir, { recursive: true });
    createBasicTemplate(targetDir, projectName);
  }

  console.log(`  Done! Next steps:\n`);
  console.log(`    cd ${projectName}`);
  console.log(`    npm install`);
  if (template === 'react') {
    console.log(`    npm run dev`);
  } else {
    console.log(`    npm run parse ./your-model.ifc`);
  }
  console.log();
}

function createBasicTemplate(targetDir: string, projectName: string) {
  const latestVersion = getLatestVersion();

  // package.json
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '1.1.6',
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

main().catch(console.error);
