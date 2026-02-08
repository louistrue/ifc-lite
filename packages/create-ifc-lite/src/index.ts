#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import { createBasicTemplate } from './templates/basic.js';
import { createServerTemplate } from './templates/server.js';
import { createServerNativeTemplate } from './templates/server-native.js';
import { fixViewerTemplate } from './utils/config-fixers.js';
import { downloadViewer } from './utils/download.js';

const TEMPLATES = {
  basic: 'basic',
  react: 'react',
  server: 'server',
  'server-native': 'server-native',
} as const;

type TemplateType = keyof typeof TEMPLATES;

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

main().catch(console.error);
