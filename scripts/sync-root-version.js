#!/usr/bin/env node

/**
 * Syncs the root package.json and Cargo.toml workspace version to the
 * highest version found across all non-private workspace packages.
 *
 * Individual package versions are NOT modified — each package keeps its
 * own version as set by `changeset version`.
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

function syncRootVersion() {
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
  console.log(`📦 Syncing root version to: ${version}`);

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
}

try {
  syncRootVersion();
} catch (error) {
  console.error('❌ Error syncing root version:', error.message);
  process.exit(1);
}
