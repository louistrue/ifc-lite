#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');

// Get version from command line argument
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  console.error('Example: node scripts/bump-version.mjs 1.1.0');
  process.exit(1);
}

// Validate version format (basic check)
if (!/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error(`Invalid version format: ${newVersion}`);
  console.error('Expected format: MAJOR.MINOR.PATCH (e.g., 1.1.0)');
  process.exit(1);
}

console.log(`Bumping version to ${newVersion}...\n`);

// Find current version from root package.json
const rootPackageJson = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf-8'));
const oldVersion = rootPackageJson.version;
console.log(`Current version: ${oldVersion}`);
console.log(`New version: ${newVersion}\n`);

// Update all package.json files
function updatePackageJson(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const pkg = JSON.parse(content);
  
  if (pkg.version) {
    pkg.version = newVersion;
    writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ✓ Updated ${filePath}`);
    return true;
  }
  return false;
}

// Update Cargo.toml files
function updateCargoToml(filePath, isWorkspace = false) {
  const content = readFileSync(filePath, 'utf-8');
  let updated = false;
  let newContent = content;
  
  // Update workspace version
  if (isWorkspace) {
    const workspaceVersionRegex = /^version\s*=\s*"[^"]+"/m;
    if (workspaceVersionRegex.test(newContent)) {
      newContent = newContent.replace(workspaceVersionRegex, `version = "${newVersion}"`);
      updated = true;
    }
  }
  
  // Update dependency versions (ifc-lite-core, ifc-lite-geometry)
  const depVersionRegex = /(ifc-lite-(?:core|geometry)\s*=\s*\{\s*version\s*=\s*)"[^"]+"/g;
  const matches = newContent.match(depVersionRegex);
  if (matches) {
    newContent = newContent.replace(depVersionRegex, `$1"${newVersion}"`);
    updated = true;
  }
  
  if (updated) {
    writeFileSync(filePath, newContent);
    console.log(`  ✓ Updated ${filePath}`);
  }
  
  return updated;
}

// Update TypeScript file with hardcoded versions
function updateTypeScriptFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  let updated = false;
  let newContent = content;
  
  // Replace version strings in template generation
  // Match: version: '1.0.0' or version: "1.0.0"
  const versionRegex = /version:\s*['"](\d+\.\d+\.\d+)['"]/g;
  if (versionRegex.test(newContent)) {
    newContent = newContent.replace(versionRegex, `version: '${newVersion}'`);
    updated = true;
  }
  
  // Replace dependency versions like '@ifc-lite/parser': '^1.0.0'
  const depRegex = /(['"]@ifc-lite\/[^'"]+['"]:\s*['"]\^)\d+\.\d+\.\d+(['"])/g;
  if (depRegex.test(newContent)) {
    newContent = newContent.replace(depRegex, `$1${newVersion}$2`);
    updated = true;
  }
  
  if (updated) {
    writeFileSync(filePath, newContent);
    console.log(`  ✓ Updated ${filePath}`);
  }
  
  return updated;
}

// Find all package.json files recursively
function findPackageJsonFiles(dir, files = []) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Skip node_modules, dist, target, and other build directories
      if (!['node_modules', 'dist', 'target', '.git', 'pkg'].includes(entry)) {
        findPackageJsonFiles(fullPath, files);
      }
    } else if (entry === 'package.json') {
      files.push(fullPath);
    }
  }
  return files;
}

// Main execution
try {
  console.log('Updating package.json files...');
  const packageJsonFiles = findPackageJsonFiles(ROOT_DIR);
  let updatedCount = 0;
  for (const file of packageJsonFiles) {
    if (updatePackageJson(file)) {
      updatedCount++;
    }
  }
  console.log(`  Updated ${updatedCount} package.json files\n`);
  
  console.log('Updating Cargo.toml files...');
  // Root workspace Cargo.toml
  updateCargoToml(join(ROOT_DIR, 'Cargo.toml'), true);
  
  // Rust workspace member Cargo.toml files with dependencies
  updateCargoToml(join(ROOT_DIR, 'rust', 'wasm-bindings', 'Cargo.toml'));
  updateCargoToml(join(ROOT_DIR, 'rust', 'geometry', 'Cargo.toml'));
  console.log();
  
  console.log('Updating TypeScript files...');
  updateTypeScriptFile(join(ROOT_DIR, 'packages', 'create-ifc-lite', 'src', 'index.ts'));
  console.log();
  
  console.log(`✅ Version bump complete! All files updated to ${newVersion}`);
  console.log('\nNext steps:');
  console.log('  1. Run: pnpm install (to update pnpm-lock.yaml)');
  console.log('  2. Rebuild WASM if needed: ./build-wasm.sh');
  console.log('  3. Test the changes');
  
} catch (error) {
  console.error('Error during version bump:', error);
  process.exit(1);
}
