#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEMPLATES = {
  basic: 'basic',
  react: 'react',
} as const;

type TemplateType = keyof typeof TEMPLATES;

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
    react   React + Vite project with WebGPU viewer
`);
}

function copyDir(src: string, dest: string) {
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(src)) {
    const srcPath = join(src, file);
    const destPath = join(dest, file);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function replaceInFile(filePath: string, replacements: Record<string, string>) {
  if (!existsSync(filePath)) return;
  let content = readFileSync(filePath, 'utf-8');
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(key, value);
  }
  writeFileSync(filePath, content);
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

  // Find templates directory (works in dev and published)
  let templatesDir = join(__dirname, '..', 'templates', template);
  if (!existsSync(templatesDir)) {
    templatesDir = join(__dirname, 'templates', template);
  }
  if (!existsSync(templatesDir)) {
    // Fallback: create inline
    mkdirSync(targetDir, { recursive: true });
    createInlineTemplate(targetDir, projectName, template);
  } else {
    copyDir(templatesDir, targetDir);
    replaceInFile(join(targetDir, 'package.json'), {
      '{{PROJECT_NAME}}': projectName,
    });
  }

  console.log(`  Done! Next steps:\n`);
  console.log(`    cd ${projectName}`);
  console.log(`    npm install`);
  if (template === 'react') {
    console.log(`    npm run dev`);
  } else {
    console.log(`    npm run parse`);
  }
  console.log();
}

function createInlineTemplate(targetDir: string, projectName: string, template: TemplateType) {
  if (template === 'basic') {
    createBasicTemplate(targetDir, projectName);
  } else {
    createReactTemplate(targetDir, projectName);
  }
}

function createBasicTemplate(targetDir: string, projectName: string) {
  // package.json
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '1.0.0',
    type: 'module',
    scripts: {
      parse: 'npx tsx src/index.ts',
      build: 'tsc',
    },
    dependencies: {
      '@ifc-lite/parser': '^1.0.0',
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
const result = parser.parse(buffer);

console.log('\\nFile parsed successfully!');
console.log(\`  Entities: \${result.entities.length}\`);

// Count by type
const typeCounts = new Map<string, number>();
for (const entity of result.entities) {
  typeCounts.set(entity.type, (typeCounts.get(entity.type) || 0) + 1);
}

console.log('\\nEntity types:');
const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [type, count] of sorted) {
  console.log(\`  \${type}: \${count}\`);
}
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

function createReactTemplate(targetDir: string, projectName: string) {
  // package.json
  writeFileSync(join(targetDir, 'package.json'), JSON.stringify({
    name: projectName,
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
    },
    dependencies: {
      '@ifc-lite/parser': '^1.0.0',
      '@ifc-lite/geometry': '^1.0.0',
      '@ifc-lite/renderer': '^1.0.0',
      react: '^18.2.0',
      'react-dom': '^18.2.0',
    },
    devDependencies: {
      '@types/react': '^18.2.0',
      '@types/react-dom': '^18.2.0',
      '@vitejs/plugin-react': '^4.2.0',
      typescript: '^5.3.0',
      vite: '^5.0.0',
    },
  }, null, 2));

  // tsconfig.json
  writeFileSync(join(targetDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    include: ['src'],
  }, null, 2));

  // vite.config.ts
  writeFileSync(join(targetDir, 'vite.config.ts'), `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`);

  // index.html
  writeFileSync(join(targetDir, 'index.html'), `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { font-family: system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);

  // src/main.tsx
  mkdirSync(join(targetDir, 'src'));
  writeFileSync(join(targetDir, 'src', 'main.tsx'), `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`);

  // src/App.tsx
  writeFileSync(join(targetDir, 'src', 'App.tsx'), `import { useState, useRef, useCallback } from 'react';
import { IfcParser } from '@ifc-lite/parser';

export default function App() {
  const [status, setStatus] = useState<string>('Drop an IFC file to get started');
  const [entities, setEntities] = useState<Array<{ type: string; count: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setStatus(\`Parsing \${file.name}...\`);

    const buffer = await file.arrayBuffer();
    const parser = new IfcParser();
    const result = parser.parse(new Uint8Array(buffer));

    // Count entities by type
    const counts = new Map<string, number>();
    for (const entity of result.entities) {
      counts.set(entity.type, (counts.get(entity.type) || 0) + 1);
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([type, count]) => ({ type, count }));

    setEntities(sorted);
    setStatus(\`Parsed \${result.entities.length} entities from \${file.name}\`);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.ifc')) {
      handleFile(file);
    }
  }, [handleFile]);

  return (
    <div style={{ padding: 24 }}>
      <h1>IFC-Lite Viewer</h1>

      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        style={{
          margin: '24px 0',
          padding: 48,
          border: '2px dashed #ccc',
          borderRadius: 8,
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        <p>{status}</p>
        <p style={{ fontSize: 14, color: '#666', marginTop: 8 }}>
          Drag & drop .ifc file here
        </p>
      </div>

      {entities.length > 0 && (
        <div>
          <h2>Entity Types</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #ddd' }}>Type</th>
                <th style={{ textAlign: 'right', padding: 8, borderBottom: '1px solid #ddd' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {entities.map(({ type, count }) => (
                <tr key={type}>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{type}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee', textAlign: 'right' }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
}
`);

  // README
  writeFileSync(join(targetDir, 'README.md'), `# ${projectName}

IFC viewer using [IFC-Lite](https://github.com/louistrue/ifc-lite).

## Quick Start

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:5173 and drop an IFC file.

## Learn More

- [IFC-Lite Documentation](https://louistrue.github.io/ifc-lite/)
- [API Reference](https://louistrue.github.io/ifc-lite/api/)
`);
}

main().catch(console.error);
