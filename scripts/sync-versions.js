#!/usr/bin/env node

/**
 * Syncs all workspace package versions to the highest version found.
 * Run this after `changeset version` to keep all versions in sync.
 *
 * Finds the maximum semver across all non-private workspace packages,
 * then bumps everything (packages, root package.json, Cargo.toml) to that version.
 * Never downgrades — only bumps packages that are behind.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

/** Compare two semver strings. Returns >0 if a > b, <0 if a < b, 0 if equal. */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function getWorkspacePackages() {
  const packages = [];
  for (const parent of ['packages', 'apps']) {
    const parentDir = join(rootDir, parent);
    try {
      for (const entry of readdirSync(parentDir)) {
        const pkgJsonPath = join(parentDir, entry, 'package.json');
        try {
          statSync(pkgJsonPath);
          packages.push(pkgJsonPath);
        } catch {
          // no package.json in this directory, skip
        }
      }
    } catch {
      // parent directory doesn't exist, skip
    }
  }
  return packages;
}

function syncVersions() {
  const packagePaths = getWorkspacePackages();

  // Find the highest version across all non-private workspace packages
  let maxVersion = '0.0.0';
  for (const pkgPath of packagePaths) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private) continue;
    if (pkg.version && compareSemver(pkg.version, maxVersion) > 0) {
      maxVersion = pkg.version;
    }
  }

  // Also consider root package.json
  const rootPackageJsonPath = join(rootDir, 'package.json');
  const rootPackageJson = JSON.parse(readFileSync(rootPackageJsonPath, 'utf8'));
  if (rootPackageJson.version && compareSemver(rootPackageJson.version, maxVersion) > 0) {
    maxVersion = rootPackageJson.version;
  }

  const version = maxVersion;
  console.log(`📦 Syncing all packages to version: ${version}`);

  // Update workspace Cargo.toml
  const cargoTomlPath = join(rootDir, 'Cargo.toml');
  let cargoToml = readFileSync(cargoTomlPath, 'utf8');

  cargoToml = cargoToml.replace(
    /(\[workspace\.package\][^\[]*version\s*=\s*")[^"]+(")/,
    `$1${version}$2`
  );

  writeFileSync(cargoTomlPath, cargoToml);
  console.log(`✅ Updated Cargo.toml workspace version to ${version}`);

  // Update root package.json
  if (rootPackageJson.version !== version) {
    rootPackageJson.version = version;
    writeFileSync(rootPackageJsonPath, JSON.stringify(rootPackageJson, null, 2) + '\n');
    console.log(`✅ Updated root package.json version to ${version}`);
  }

  // Bump any lagging workspace packages (never downgrades)
  for (const pkgPath of packagePaths) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    if (pkg.private) continue;
    if (compareSemver(pkg.version, version) >= 0) continue; // already at or above target

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
