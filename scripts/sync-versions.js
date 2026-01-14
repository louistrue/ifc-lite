#!/usr/bin/env node

/**
 * Syncs version from package.json to Cargo.toml workspace
 * Run this after `changeset version` to keep Rust and npm versions in sync
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

function syncVersions() {
  // Read version from package.json
  const packageJsonPath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const version = packageJson.version;

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

  // Also update root package.json if needed (in case changesets didn't update it)
  if (packageJson.version !== version) {
    packageJson.version = version;
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    console.log(`✅ Updated root package.json version to ${version}`);
  }
}

try {
  syncVersions();
} catch (error) {
  console.error('❌ Error syncing versions:', error.message);
  process.exit(1);
}
