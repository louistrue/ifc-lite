import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';
import fs from 'fs';

// --- Build-time changelog parser ---

interface ReleaseHighlight {
  type: 'feature' | 'fix' | 'perf';
  text: string;
}

interface PackageRelease {
  version: string;
  highlights: ReleaseHighlight[];
}

interface PackageChangelog {
  name: string;
  releases: PackageRelease[];
}

interface PackageVersion {
  name: string;
  version: string;
}

const SKIP_BOLD_LOWER = new Set([
  'bug fixes', 'new features', 'performance improvements', 'technical details',
  'renderer fixes', 'parser fixes', 'viewer integration', 'fixes', 'features',
  'breaking', 'minor changes', 'patch changes', 'dependencies',
]);

function isInternalName(text: string): boolean {
  // Skip PascalCase single-word class names like "PolygonalFaceSetProcessor"
  return /^[A-Z][a-zA-Z]+$/.test(text) && !text.includes(' ');
}

function categorizeHighlight(text: string): 'feature' | 'fix' | 'perf' {
  const lower = text.toLowerCase();
  if (lower.startsWith('fixed ') || lower.startsWith('fix ')) return 'fix';
  if (
    lower.includes('performance') || lower.includes('optimiz') ||
    lower.includes('zero-copy') || lower.includes('faster') ||
    lower.includes('batch siz')
  ) return 'perf';
  return 'feature';
}

function extractBulletDescription(line: string): string | null {
  let text = line.replace(/^-\s+/, '');

  // Pattern: "HASH: ### Header" -> skip inline section headers
  if (/^[a-f0-9]{7,}:\s*###/.test(text)) return null;

  // Pattern: "HASH: feat/fix/perf: DESCRIPTION"
  const hashPrefixed = text.match(/^[a-f0-9]{7,}:\s*(?:feat|fix|perf|refactor|chore):\s*(.+)$/i);
  if (hashPrefixed) return hashPrefixed[1].trim();

  // Pattern: "HASH: DESCRIPTION" (without conventional commit prefix)
  const hashOnly = text.match(/^[a-f0-9]{7,}:\s*(.+)$/);
  if (hashOnly) return hashOnly[1].trim();

  // Pattern: "[#PR](url) [`hash`](url) Thanks @user! - DESCRIPTION"
  const prPattern = text.match(/Thanks\s+\[@[^\]]+\]\([^)]+\)!\s*-\s*(.+)$/);
  if (prPattern) return prPattern[1].trim();

  return null;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function parseChangelogs(): PackageChangelog[] {
  const packagesDir = path.resolve(__dirname, '../../packages');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(packagesDir);
  } catch {
    return [];
  }

  const MAX_HIGHLIGHTS_PER_VERSION = 12;
  const result: PackageChangelog[] = [];

  for (const dir of dirs) {
    const changelogPath = path.join(packagesDir, dir, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) continue;

    const content = fs.readFileSync(changelogPath, 'utf-8');

    // Read package name from package.json
    let pkgName = dir;
    try {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(packagesDir, dir, 'package.json'), 'utf-8')
      );
      pkgName = pkgJson.name || dir;
    } catch { /* use dir name as fallback */ }

    const seenVersions = new Set<string>();
    const releases: PackageRelease[] = [];

    // Split into version blocks
    const versionBlocks = content.split(/^## /m).slice(1);

    for (const block of versionBlocks) {
      const versionMatch = block.match(/^(\d+\.\d+\.\d+)/);
      if (!versionMatch) continue;
      const version = versionMatch[1];

      // Skip duplicate version sections within same file
      if (seenVersions.has(version)) continue;
      seenVersions.add(version);

      const highlights = new Map<string, ReleaseHighlight>();
      const lines = block.split('\n');

      // 1) Extract top-level bullet descriptions (lines starting with "- " at root indent)
      for (const line of lines) {
        if (!line.startsWith('- ')) continue;
        if (line.startsWith('- Updated dependencies')) continue;

        const desc = extractBulletDescription(line);
        if (desc && desc.length >= 10) {
          const key = desc.toLowerCase().substring(0, 60);
          if (!highlights.has(key)) {
            highlights.set(key, { type: categorizeHighlight(desc), text: desc });
          }
        }
      }

      // 2) Extract bold items as highlights (nested feature names)
      const boldRegex = /\*\*([^*]+)\*\*/g;
      let match;
      while ((match = boldRegex.exec(block)) !== null) {
        let text = match[1].trim();
        if (text.endsWith(':')) text = text.slice(0, -1);
        if (text.includes('@ifc-lite/')) continue;
        if (SKIP_BOLD_LOWER.has(text.toLowerCase())) continue;
        if (text.length < 10) continue;
        if (isInternalName(text)) continue;

        const key = text.toLowerCase().substring(0, 60);
        if (!highlights.has(key)) {
          highlights.set(key, { type: categorizeHighlight(text), text });
        }
      }

      if (highlights.size > 0) {
        releases.push({
          version,
          highlights: Array.from(highlights.values()).slice(0, MAX_HIGHLIGHTS_PER_VERSION),
        });
      }
    }

    if (releases.length > 0) {
      // Already sorted by file order (newest first in CHANGELOG.md)
      result.push({ name: pkgName, releases });
    }
  }

  // Sort packages: those with the most release content first
  return result.sort((a, b) => {
    const aTotal = a.releases.reduce((s, r) => s + r.highlights.length, 0);
    const bTotal = b.releases.reduce((s, r) => s + r.highlights.length, 0);
    return bTotal - aTotal;
  });
}

// Read version from viewer package.json (primary app version) with root fallback
const viewerPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, './package.json'), 'utf-8')
);
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')
);
const appVersion = viewerPkg.version || rootPkg.version;

// Collect all package versions
function collectPackageVersions(): PackageVersion[] {
  const packagesDir = path.resolve(__dirname, '../../packages');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(packagesDir);
  } catch {
    return [];
  }

  const versions: PackageVersion[] = [];
  for (const dir of dirs) {
    const pkgPath = path.join(packagesDir, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && pkg.version) {
        versions.push({ name: pkg.name, version: pkg.version });
      }
    } catch { /* skip unreadable packages */ }
  }
  return versions.sort((a, b) => a.name.localeCompare(b.name));
}

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __RELEASE_HISTORY__: JSON.stringify(parseChangelogs()),
    __PACKAGE_VERSIONS__: JSON.stringify(collectPackageVersions()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ifc-lite/parser': path.resolve(__dirname, '../../packages/parser/src'),
      '@ifc-lite/geometry': path.resolve(__dirname, '../../packages/geometry/src'),
      '@ifc-lite/renderer': path.resolve(__dirname, '../../packages/renderer/src'),
      '@ifc-lite/query': path.resolve(__dirname, '../../packages/query/src'),
      '@ifc-lite/server-client': path.resolve(__dirname, '../../packages/server-client/src'),
      '@ifc-lite/spatial': path.resolve(__dirname, '../../packages/spatial/src'),
      '@ifc-lite/data': path.resolve(__dirname, '../../packages/data/src'),
      '@ifc-lite/export': path.resolve(__dirname, '../../packages/export/src'),
      '@ifc-lite/cache': path.resolve(__dirname, '../../packages/cache/src'),
      '@ifc-lite/ifcx': path.resolve(__dirname, '../../packages/ifcx/src'),
      '@ifc-lite/wasm': path.resolve(__dirname, '../../packages/wasm/pkg/ifc-lite.js'),
      '@ifc-lite/sdk': path.resolve(__dirname, '../../packages/sdk/src'),
      '@ifc-lite/lens': path.resolve(__dirname, '../../packages/lens/src'),
      '@ifc-lite/mutations': path.resolve(__dirname, '../../packages/mutations/src'),
      '@ifc-lite/bcf': path.resolve(__dirname, '../../packages/bcf/src'),
      '@ifc-lite/drawing-2d': path.resolve(__dirname, '../../packages/drawing-2d/src'),
      '@ifc-lite/encoding': path.resolve(__dirname, '../../packages/encoding/src'),
      '@ifc-lite/ids': path.resolve(__dirname, '../../packages/ids/src'),
      '@ifc-lite/lists': path.resolve(__dirname, '../../packages/lists/src'),
    },
  },
  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: {
      allow: ['../..'],
    },
    proxy: {
      '/api/bsdd': {
        target: 'https://api.bsdd.buildingsmart.org',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/bsdd/, ''),
      },
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@ifc-lite/wasm', 'parquet-wasm'],
  },
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
});
