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

interface Release {
  version: string;
  highlights: ReleaseHighlight[];
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

function parseChangelogs(): Release[] {
  const packagesDir = path.resolve(__dirname, '../../packages');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(packagesDir);
  } catch {
    return [];
  }

  const versionMap = new Map<string, Map<string, ReleaseHighlight>>();
  const seenVersionsPerFile = new Map<string, Set<string>>();

  for (const dir of dirs) {
    const changelogPath = path.join(packagesDir, dir, 'CHANGELOG.md');
    if (!fs.existsSync(changelogPath)) continue;

    const content = fs.readFileSync(changelogPath, 'utf-8');
    const fileKey = dir;
    seenVersionsPerFile.set(fileKey, new Set());

    // Split into version blocks
    const versionBlocks = content.split(/^## /m).slice(1);

    for (const block of versionBlocks) {
      const versionMatch = block.match(/^(\d+\.\d+\.\d+)/);
      if (!versionMatch) continue;
      const version = versionMatch[1];

      // Skip duplicate version sections within same file
      if (seenVersionsPerFile.get(fileKey)!.has(version)) continue;
      seenVersionsPerFile.get(fileKey)!.add(version);

      if (!versionMap.has(version)) {
        versionMap.set(version, new Map());
      }
      const highlights = versionMap.get(version)!;

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
    }
  }

  const MAX_HIGHLIGHTS_PER_VERSION = 12;

  return Array.from(versionMap.entries())
    .sort((a, b) => compareSemver(b[0], a[0]))
    .map(([version, highlights]) => ({
      version,
      highlights: Array.from(highlights.values()).slice(0, MAX_HIGHLIGHTS_PER_VERSION),
    }))
    .filter((r) => r.highlights.length > 0);
}

// Read version from root package.json
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')
);

export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __RELEASE_HISTORY__: JSON.stringify(parseChangelogs()),
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
