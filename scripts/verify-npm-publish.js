#!/usr/bin/env node

/**
 * Verifies that all non-private workspace packages are published on npm at
 * their expected version. Run this after a release to catch packages that
 * were accidentally skipped during publish.
 *
 * Usage:
 *   node scripts/verify-npm-publish.js
 *   node scripts/verify-npm-publish.js --retries 5 --delay 10000
 *
 * Options:
 *   --retries <n>   Number of retry attempts per package (default: 3).
 *                   Useful after a fresh publish where npm propagation takes
 *                   a few seconds.
 *   --delay <ms>    Milliseconds to wait between retries (default: 5000).
 */

import { execSync } from 'child_process';
import { readFileSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// ── CLI option parsing ────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let retries = 3;
  let delay = 5000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--retries' && args[i + 1]) retries = parseInt(args[++i], 10);
    if (args[i] === '--delay'   && args[i + 1]) delay   = parseInt(args[++i], 10);
  }
  return { retries, delay };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Query npm for the published version of `name@version`.
 * Returns true when the exact version is available, false otherwise.
 */
function isPublished(name, version) {
  try {
    const result = execSync(`npm view ${name}@${version} version`, { stdio: 'pipe' });
    return result.toString().trim() === version;
  } catch {
    return false;
  }
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
          // no package.json, skip
        }
      }
    } catch {
      // parent dir doesn't exist, skip
    }
  }
  return packages;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { retries, delay } = parseArgs();

  const packagePaths = getWorkspacePackages();
  const toCheck = [];

  for (const pkgPath of packagePaths) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.private || !pkg.name || !pkg.version) continue;
    toCheck.push({ name: pkg.name, version: pkg.version });
  }

  if (toCheck.length === 0) {
    console.log('No publishable packages found.');
    process.exit(0);
  }

  console.log(`\nVerifying ${toCheck.length} package(s) on npm (up to ${retries} retries each)…\n`);

  const failed = [];

  for (const { name, version } of toCheck) {
    let published = false;
    for (let attempt = 1; attempt <= retries; attempt++) {
      published = isPublished(name, version);
      if (published) break;
      if (attempt < retries) {
        console.log(`  ⏳  ${name}@${version} not yet visible — waiting ${delay / 1000}s (attempt ${attempt}/${retries})…`);
        await sleep(delay);
      }
    }

    if (published) {
      console.log(`  ✅  ${name}@${version}`);
    } else {
      console.log(`  ❌  ${name}@${version} — NOT found on npm`);
      failed.push({ name, version });
    }
  }

  console.log();

  if (failed.length > 0) {
    console.error(`${failed.length} package(s) missing from npm after publish:\n`);
    for (const { name, version } of failed) {
      console.error(`  • ${name}@${version}`);
    }
    console.error(
      '\nThis usually means the package was not included in the changeset or\n' +
      'the publish step failed silently.  Check the release logs and re-run\n' +
      '`pnpm publish -r --filter <package>` for the affected package(s).\n'
    );
    process.exit(1);
  }

  console.log('All packages are published. 🎉');
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
