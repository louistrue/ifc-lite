#!/usr/bin/env node

/**
 * Syncs version from @ifc-lite/wasm package.json to all workspace packages,
 * Cargo.toml workspace, and root package.json.
 * Run this after `changeset version` to keep all versions in sync.
 *
 * Why @ifc-lite/wasm? Because changesets updates individual package versions but not the
 * private workspace root. We use @ifc-lite/wasm as the source of truth since it's the npm
 * package that wraps the Rust WASM bindings.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function getWorkspacePackageDirs() {
  const dirs = [];
  for (const parent of ['packages', 'apps']) {
    const parentDir = join(rootDir, parent);
    try {
      for (const entry of readdirSync(parentDir)) {
        const pkgJsonPath = join(parentDir, entry, 'package.json');
        try {
          statSync(pkgJsonPath);
          dirs.push(pkgJsonPath);
        } catch {
          // no package.json in this directory, skip
        }
      }
    } catch {
      // parent directory doesn't exist, skip
    }
  }
  return dirs;
}

function syncVersions() {
  // Read version from @ifc-lite/wasm (the npm package for Rust WASM bindings)
  // This is the authoritative source since changesets updates it but not the root package.json
  const wasmPackageJsonPath = join(rootDir, 'packages', 'wasm', 'package.json');
  const wasmPackageJson = JSON.parse(readFileSync(wasmPackageJsonPath, 'utf8'));
  const version = wasmPackageJson.version;

  console.log(`📦 Syncing version: ${version}`);

  // Update workspace Cargo.toml
  const cargoTomlPath = join(rootDir, 'Cargo.toml');
  let cargoToml = readFileSync(cargoTomlPath, 'utf8');

  // Replace version in [workspace.package] section
  cargoToml = cargoToml.replace(
    /(\[workspace\.package\][^\[]*version\s*=\s*")[^"]+(")/,
    `$1${version}$2`
  );

  writeFileSync(cargoTomlPath, cargoToml);
  console.log(`✅ Updated Cargo.toml workspace version to ${version}`);

  // Also update root package.json to keep it in sync
  const rootPackageJsonPath = join(rootDir, 'package.json');
  const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
  if (rootPackageJson.version !== version) {
    rootPackageJson.version = version;
    writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2) + '\n');
    console.log(`✅ Updated root package.json version to ${version}`);
  }

  // Sync all workspace package versions to match
  const packagePaths = getWorkspacePackageDirs();
  for (const pkgPath of packagePaths) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private) continue; // skip private packages (apps, etc.)
    if (pkg.version === version) continue; // already in sync

    const oldVersion = pkg.version;
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`✅ Updated ${pkg.name} from ${oldVersion} to ${version}`);
  }
}

try {
  syncVersions();
} catch (error) {
  console.error('❌ Error syncing versions:', error.message);
  process.exit(1);
}
