// vite.config.ts
import { defineConfig } from "file:///workspaces/ifc-lite/node_modules/.pnpm/vite@5.4.21_@types+node@20.19.28_lightningcss@1.30.2/node_modules/vite/dist/node/index.js";
import react from "file:///workspaces/ifc-lite/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@20.19.28_lightningcss@1.30.2_/node_modules/@vitejs/plugin-react/dist/index.js";
import wasm from "file:///workspaces/ifc-lite/node_modules/.pnpm/vite-plugin-wasm@3.5.0_vite@5.4.21_@types+node@20.19.28_lightningcss@1.30.2_/node_modules/vite-plugin-wasm/exports/import.mjs";
import topLevelAwait from "file:///workspaces/ifc-lite/node_modules/.pnpm/vite-plugin-top-level-await@1.6.0_rollup@4.55.1_vite@5.4.21_@types+node@20.19.28_lightningcss@1.30.2_/node_modules/vite-plugin-top-level-await/exports/import.mjs";
import path from "path";
import fs from "fs";
var __vite_injected_original_dirname = "/workspaces/ifc-lite/apps/viewer";
var SKIP_BOLD_LOWER = /* @__PURE__ */ new Set([
  "bug fixes",
  "new features",
  "performance improvements",
  "technical details",
  "renderer fixes",
  "parser fixes",
  "viewer integration",
  "fixes",
  "features",
  "breaking",
  "minor changes",
  "patch changes",
  "dependencies"
]);
function isInternalName(text) {
  return /^[A-Z][a-zA-Z]+$/.test(text) && !text.includes(" ");
}
function categorizeHighlight(text) {
  const lower = text.toLowerCase();
  if (lower.startsWith("fixed ") || lower.startsWith("fix ")) return "fix";
  if (lower.includes("performance") || lower.includes("optimiz") || lower.includes("zero-copy") || lower.includes("faster") || lower.includes("batch siz")) return "perf";
  return "feature";
}
function extractBulletDescription(line) {
  let text = line.replace(/^-\s+/, "");
  if (/^[a-f0-9]{7,}:\s*###/.test(text)) return null;
  const hashPrefixed = text.match(/^[a-f0-9]{7,}:\s*(?:feat|fix|perf|refactor|chore):\s*(.+)$/i);
  if (hashPrefixed) return hashPrefixed[1].trim();
  const hashOnly = text.match(/^[a-f0-9]{7,}:\s*(.+)$/);
  if (hashOnly) return hashOnly[1].trim();
  const prPattern = text.match(/Thanks\s+\[@[^\]]+\]\([^)]+\)!\s*-\s*(.+)$/);
  if (prPattern) return prPattern[1].trim();
  return null;
}
function parseChangelogs() {
  const packagesDir = path.resolve(__vite_injected_original_dirname, "../../packages");
  let dirs;
  try {
    dirs = fs.readdirSync(packagesDir);
  } catch {
    return [];
  }
  const MAX_HIGHLIGHTS_PER_VERSION = 12;
  const result = [];
  for (const dir of dirs) {
    const changelogPath = path.join(packagesDir, dir, "CHANGELOG.md");
    if (!fs.existsSync(changelogPath)) continue;
    const content = fs.readFileSync(changelogPath, "utf-8");
    let pkgName = dir;
    try {
      const pkgJson = JSON.parse(
        fs.readFileSync(path.join(packagesDir, dir, "package.json"), "utf-8")
      );
      pkgName = pkgJson.name || dir;
    } catch {
    }
    const seenVersions = /* @__PURE__ */ new Set();
    const releases = [];
    const versionBlocks = content.split(/^## /m).slice(1);
    for (const block of versionBlocks) {
      const versionMatch = block.match(/^(\d+\.\d+\.\d+)/);
      if (!versionMatch) continue;
      const version = versionMatch[1];
      if (seenVersions.has(version)) continue;
      seenVersions.add(version);
      const highlights = /* @__PURE__ */ new Map();
      const lines = block.split("\n");
      for (const line of lines) {
        if (!line.startsWith("- ")) continue;
        if (line.startsWith("- Updated dependencies")) continue;
        const desc = extractBulletDescription(line);
        if (desc && desc.length >= 10) {
          const key = desc.toLowerCase().substring(0, 60);
          if (!highlights.has(key)) {
            highlights.set(key, { type: categorizeHighlight(desc), text: desc });
          }
        }
      }
      const boldRegex = /\*\*([^*]+)\*\*/g;
      let match;
      while ((match = boldRegex.exec(block)) !== null) {
        let text = match[1].trim();
        if (text.endsWith(":")) text = text.slice(0, -1);
        if (text.includes("@ifc-lite/")) continue;
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
          highlights: Array.from(highlights.values()).slice(0, MAX_HIGHLIGHTS_PER_VERSION)
        });
      }
    }
    if (releases.length > 0) {
      result.push({ name: pkgName, releases });
    }
  }
  return result.sort((a, b) => {
    const aTotal = a.releases.reduce((s, r) => s + r.highlights.length, 0);
    const bTotal = b.releases.reduce((s, r) => s + r.highlights.length, 0);
    return bTotal - aTotal;
  });
}
function collectPackageVersions() {
  const packagesDir = path.resolve(__vite_injected_original_dirname, "../../packages");
  let dirs;
  try {
    dirs = fs.readdirSync(packagesDir);
  } catch {
    return [];
  }
  const versions = [];
  for (const dir of dirs) {
    const pkgPath = path.join(packagesDir, dir, "package.json");
    if (!fs.existsSync(pkgPath)) continue;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name && pkg.version) {
        versions.push({ name: pkg.name, version: pkg.version });
      }
    } catch {
    }
  }
  return versions.sort((a, b) => a.name.localeCompare(b.name));
}
var viewerPkg = JSON.parse(
  fs.readFileSync(path.resolve(__vite_injected_original_dirname, "./package.json"), "utf-8")
);
var rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__vite_injected_original_dirname, "../../package.json"), "utf-8")
);
var appVersion = viewerPkg.version || rootPkg.version;
var vite_config_default = defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait()
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_DATE__: JSON.stringify((/* @__PURE__ */ new Date()).toISOString()),
    __RELEASE_HISTORY__: JSON.stringify(parseChangelogs()),
    __PACKAGE_VERSIONS__: JSON.stringify(collectPackageVersions())
  },
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src"),
      "@ifc-lite/parser": path.resolve(__vite_injected_original_dirname, "../../packages/parser/src"),
      "@ifc-lite/geometry": path.resolve(__vite_injected_original_dirname, "../../packages/geometry/src"),
      "@ifc-lite/renderer": path.resolve(__vite_injected_original_dirname, "../../packages/renderer/src"),
      "@ifc-lite/query": path.resolve(__vite_injected_original_dirname, "../../packages/query/src"),
      "@ifc-lite/server-client": path.resolve(__vite_injected_original_dirname, "../../packages/server-client/src"),
      "@ifc-lite/spatial": path.resolve(__vite_injected_original_dirname, "../../packages/spatial/src"),
      "@ifc-lite/data": path.resolve(__vite_injected_original_dirname, "../../packages/data/src"),
      "@ifc-lite/export": path.resolve(__vite_injected_original_dirname, "../../packages/export/src"),
      "@ifc-lite/cache": path.resolve(__vite_injected_original_dirname, "../../packages/cache/src"),
      "@ifc-lite/ifcx": path.resolve(__vite_injected_original_dirname, "../../packages/ifcx/src"),
      "@ifc-lite/wasm": path.resolve(__vite_injected_original_dirname, "../../packages/wasm/pkg/ifc-lite.js"),
      "@ifc-lite/sdk": path.resolve(__vite_injected_original_dirname, "../../packages/sdk/src"),
      "@ifc-lite/create": path.resolve(__vite_injected_original_dirname, "../../packages/create/src"),
      "@ifc-lite/sandbox/schema": path.resolve(__vite_injected_original_dirname, "../../packages/sandbox/src/bridge-schema.ts"),
      "@ifc-lite/sandbox": path.resolve(__vite_injected_original_dirname, "../../packages/sandbox/src"),
      "@ifc-lite/lens": path.resolve(__vite_injected_original_dirname, "../../packages/lens/src"),
      "@ifc-lite/mutations": path.resolve(__vite_injected_original_dirname, "../../packages/mutations/src"),
      "@ifc-lite/bcf": path.resolve(__vite_injected_original_dirname, "../../packages/bcf/src"),
      "@ifc-lite/drawing-2d": path.resolve(__vite_injected_original_dirname, "../../packages/drawing-2d/src"),
      "@ifc-lite/encoding": path.resolve(__vite_injected_original_dirname, "../../packages/encoding/src"),
      "@ifc-lite/ids": path.resolve(__vite_injected_original_dirname, "../../packages/ids/src"),
      "@ifc-lite/lists": path.resolve(__vite_injected_original_dirname, "../../packages/lists/src")
    }
  },
  server: {
    port: 3e3,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      // Allows third-party no-cors resources like Stripe.js while preserving
      // cross-origin isolation in modern browsers.
      "Cross-Origin-Embedder-Policy": "credentialless"
    },
    fs: {
      allow: ["../.."]
    },
    proxy: {
      "/api/chat": {
        // Single API source of truth lives at repo-root `api/chat.ts`.
        // For local dev, run `pnpm dev:api` from repo root.
        target: "http://localhost:3001",
        changeOrigin: true
      },
      "/api/bsdd": {
        target: "https://api.bsdd.buildingsmart.org",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/bsdd/, "")
      }
    }
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 6e3
  },
  optimizeDeps: {
    exclude: [
      "@duckdb/duckdb-wasm",
      "@ifc-lite/wasm",
      "parquet-wasm",
      "quickjs-emscripten",
      "@jitl/quickjs-wasmfile-release-asyncify",
      "esbuild-wasm"
    ]
  },
  worker: {
    format: "es",
    plugins: () => [wasm(), topLevelAwait()]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvd29ya3NwYWNlcy9pZmMtbGl0ZS9hcHBzL3ZpZXdlclwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3dvcmtzcGFjZXMvaWZjLWxpdGUvYXBwcy92aWV3ZXIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3dvcmtzcGFjZXMvaWZjLWxpdGUvYXBwcy92aWV3ZXIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgd2FzbSBmcm9tICd2aXRlLXBsdWdpbi13YXNtJztcbmltcG9ydCB0b3BMZXZlbEF3YWl0IGZyb20gJ3ZpdGUtcGx1Z2luLXRvcC1sZXZlbC1hd2FpdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5cbi8vIC0tLSBCdWlsZC10aW1lIGNoYW5nZWxvZyBwYXJzZXIgLS0tXG5cbmludGVyZmFjZSBSZWxlYXNlSGlnaGxpZ2h0IHtcbiAgdHlwZTogJ2ZlYXR1cmUnIHwgJ2ZpeCcgfCAncGVyZic7XG4gIHRleHQ6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFBhY2thZ2VSZWxlYXNlIHtcbiAgdmVyc2lvbjogc3RyaW5nO1xuICBoaWdobGlnaHRzOiBSZWxlYXNlSGlnaGxpZ2h0W107XG59XG5cbmludGVyZmFjZSBQYWNrYWdlQ2hhbmdlbG9nIHtcbiAgbmFtZTogc3RyaW5nO1xuICByZWxlYXNlczogUGFja2FnZVJlbGVhc2VbXTtcbn1cblxuaW50ZXJmYWNlIFBhY2thZ2VWZXJzaW9uIHtcbiAgbmFtZTogc3RyaW5nO1xuICB2ZXJzaW9uOiBzdHJpbmc7XG59XG5cbmNvbnN0IFNLSVBfQk9MRF9MT1dFUiA9IG5ldyBTZXQoW1xuICAnYnVnIGZpeGVzJywgJ25ldyBmZWF0dXJlcycsICdwZXJmb3JtYW5jZSBpbXByb3ZlbWVudHMnLCAndGVjaG5pY2FsIGRldGFpbHMnLFxuICAncmVuZGVyZXIgZml4ZXMnLCAncGFyc2VyIGZpeGVzJywgJ3ZpZXdlciBpbnRlZ3JhdGlvbicsICdmaXhlcycsICdmZWF0dXJlcycsXG4gICdicmVha2luZycsICdtaW5vciBjaGFuZ2VzJywgJ3BhdGNoIGNoYW5nZXMnLCAnZGVwZW5kZW5jaWVzJyxcbl0pO1xuXG5mdW5jdGlvbiBpc0ludGVybmFsTmFtZSh0ZXh0OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gU2tpcCBQYXNjYWxDYXNlIHNpbmdsZS13b3JkIGNsYXNzIG5hbWVzIGxpa2UgXCJQb2x5Z29uYWxGYWNlU2V0UHJvY2Vzc29yXCJcbiAgcmV0dXJuIC9eW0EtWl1bYS16QS1aXSskLy50ZXN0KHRleHQpICYmICF0ZXh0LmluY2x1ZGVzKCcgJyk7XG59XG5cbmZ1bmN0aW9uIGNhdGVnb3JpemVIaWdobGlnaHQodGV4dDogc3RyaW5nKTogJ2ZlYXR1cmUnIHwgJ2ZpeCcgfCAncGVyZicge1xuICBjb25zdCBsb3dlciA9IHRleHQudG9Mb3dlckNhc2UoKTtcbiAgaWYgKGxvd2VyLnN0YXJ0c1dpdGgoJ2ZpeGVkICcpIHx8IGxvd2VyLnN0YXJ0c1dpdGgoJ2ZpeCAnKSkgcmV0dXJuICdmaXgnO1xuICBpZiAoXG4gICAgbG93ZXIuaW5jbHVkZXMoJ3BlcmZvcm1hbmNlJykgfHwgbG93ZXIuaW5jbHVkZXMoJ29wdGltaXonKSB8fFxuICAgIGxvd2VyLmluY2x1ZGVzKCd6ZXJvLWNvcHknKSB8fCBsb3dlci5pbmNsdWRlcygnZmFzdGVyJykgfHxcbiAgICBsb3dlci5pbmNsdWRlcygnYmF0Y2ggc2l6JylcbiAgKSByZXR1cm4gJ3BlcmYnO1xuICByZXR1cm4gJ2ZlYXR1cmUnO1xufVxuXG5mdW5jdGlvbiBleHRyYWN0QnVsbGV0RGVzY3JpcHRpb24obGluZTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbCB7XG4gIGxldCB0ZXh0ID0gbGluZS5yZXBsYWNlKC9eLVxccysvLCAnJyk7XG5cbiAgLy8gUGF0dGVybjogXCJIQVNIOiAjIyMgSGVhZGVyXCIgLT4gc2tpcCBpbmxpbmUgc2VjdGlvbiBoZWFkZXJzXG4gIGlmICgvXlthLWYwLTldezcsfTpcXHMqIyMjLy50ZXN0KHRleHQpKSByZXR1cm4gbnVsbDtcblxuICAvLyBQYXR0ZXJuOiBcIkhBU0g6IGZlYXQvZml4L3BlcmY6IERFU0NSSVBUSU9OXCJcbiAgY29uc3QgaGFzaFByZWZpeGVkID0gdGV4dC5tYXRjaCgvXlthLWYwLTldezcsfTpcXHMqKD86ZmVhdHxmaXh8cGVyZnxyZWZhY3RvcnxjaG9yZSk6XFxzKiguKykkL2kpO1xuICBpZiAoaGFzaFByZWZpeGVkKSByZXR1cm4gaGFzaFByZWZpeGVkWzFdLnRyaW0oKTtcblxuICAvLyBQYXR0ZXJuOiBcIkhBU0g6IERFU0NSSVBUSU9OXCIgKHdpdGhvdXQgY29udmVudGlvbmFsIGNvbW1pdCBwcmVmaXgpXG4gIGNvbnN0IGhhc2hPbmx5ID0gdGV4dC5tYXRjaCgvXlthLWYwLTldezcsfTpcXHMqKC4rKSQvKTtcbiAgaWYgKGhhc2hPbmx5KSByZXR1cm4gaGFzaE9ubHlbMV0udHJpbSgpO1xuXG4gIC8vIFBhdHRlcm46IFwiWyNQUl0odXJsKSBbYGhhc2hgXSh1cmwpIFRoYW5rcyBAdXNlciEgLSBERVNDUklQVElPTlwiXG4gIGNvbnN0IHByUGF0dGVybiA9IHRleHQubWF0Y2goL1RoYW5rc1xccytcXFtAW15cXF1dK1xcXVxcKFteKV0rXFwpIVxccyotXFxzKiguKykkLyk7XG4gIGlmIChwclBhdHRlcm4pIHJldHVybiBwclBhdHRlcm5bMV0udHJpbSgpO1xuXG4gIHJldHVybiBudWxsO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU2VtdmVyKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3QgcGEgPSBhLnNwbGl0KCcuJykubWFwKE51bWJlcik7XG4gIGNvbnN0IHBiID0gYi5zcGxpdCgnLicpLm1hcChOdW1iZXIpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IDM7IGkrKykge1xuICAgIGlmIChwYVtpXSAhPT0gcGJbaV0pIHJldHVybiBwYVtpXSAtIHBiW2ldO1xuICB9XG4gIHJldHVybiAwO1xufVxuXG5mdW5jdGlvbiBwYXJzZUNoYW5nZWxvZ3MoKTogUGFja2FnZUNoYW5nZWxvZ1tdIHtcbiAgY29uc3QgcGFja2FnZXNEaXIgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMnKTtcbiAgbGV0IGRpcnM6IHN0cmluZ1tdO1xuICB0cnkge1xuICAgIGRpcnMgPSBmcy5yZWFkZGlyU3luYyhwYWNrYWdlc0Rpcik7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIGNvbnN0IE1BWF9ISUdITElHSFRTX1BFUl9WRVJTSU9OID0gMTI7XG4gIGNvbnN0IHJlc3VsdDogUGFja2FnZUNoYW5nZWxvZ1tdID0gW107XG5cbiAgZm9yIChjb25zdCBkaXIgb2YgZGlycykge1xuICAgIGNvbnN0IGNoYW5nZWxvZ1BhdGggPSBwYXRoLmpvaW4ocGFja2FnZXNEaXIsIGRpciwgJ0NIQU5HRUxPRy5tZCcpO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhjaGFuZ2Vsb2dQYXRoKSkgY29udGludWU7XG5cbiAgICBjb25zdCBjb250ZW50ID0gZnMucmVhZEZpbGVTeW5jKGNoYW5nZWxvZ1BhdGgsICd1dGYtOCcpO1xuXG4gICAgLy8gUmVhZCBwYWNrYWdlIG5hbWUgZnJvbSBwYWNrYWdlLmpzb25cbiAgICBsZXQgcGtnTmFtZSA9IGRpcjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGtnSnNvbiA9IEpTT04ucGFyc2UoXG4gICAgICAgIGZzLnJlYWRGaWxlU3luYyhwYXRoLmpvaW4ocGFja2FnZXNEaXIsIGRpciwgJ3BhY2thZ2UuanNvbicpLCAndXRmLTgnKVxuICAgICAgKTtcbiAgICAgIHBrZ05hbWUgPSBwa2dKc29uLm5hbWUgfHwgZGlyO1xuICAgIH0gY2F0Y2ggeyAvKiB1c2UgZGlyIG5hbWUgYXMgZmFsbGJhY2sgKi8gfVxuXG4gICAgY29uc3Qgc2VlblZlcnNpb25zID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gICAgY29uc3QgcmVsZWFzZXM6IFBhY2thZ2VSZWxlYXNlW10gPSBbXTtcblxuICAgIC8vIFNwbGl0IGludG8gdmVyc2lvbiBibG9ja3NcbiAgICBjb25zdCB2ZXJzaW9uQmxvY2tzID0gY29udGVudC5zcGxpdCgvXiMjIC9tKS5zbGljZSgxKTtcblxuICAgIGZvciAoY29uc3QgYmxvY2sgb2YgdmVyc2lvbkJsb2Nrcykge1xuICAgICAgY29uc3QgdmVyc2lvbk1hdGNoID0gYmxvY2subWF0Y2goL14oXFxkK1xcLlxcZCtcXC5cXGQrKS8pO1xuICAgICAgaWYgKCF2ZXJzaW9uTWF0Y2gpIGNvbnRpbnVlO1xuICAgICAgY29uc3QgdmVyc2lvbiA9IHZlcnNpb25NYXRjaFsxXTtcblxuICAgICAgLy8gU2tpcCBkdXBsaWNhdGUgdmVyc2lvbiBzZWN0aW9ucyB3aXRoaW4gc2FtZSBmaWxlXG4gICAgICBpZiAoc2VlblZlcnNpb25zLmhhcyh2ZXJzaW9uKSkgY29udGludWU7XG4gICAgICBzZWVuVmVyc2lvbnMuYWRkKHZlcnNpb24pO1xuXG4gICAgICBjb25zdCBoaWdobGlnaHRzID0gbmV3IE1hcDxzdHJpbmcsIFJlbGVhc2VIaWdobGlnaHQ+KCk7XG4gICAgICBjb25zdCBsaW5lcyA9IGJsb2NrLnNwbGl0KCdcXG4nKTtcblxuICAgICAgLy8gMSkgRXh0cmFjdCB0b3AtbGV2ZWwgYnVsbGV0IGRlc2NyaXB0aW9ucyAobGluZXMgc3RhcnRpbmcgd2l0aCBcIi0gXCIgYXQgcm9vdCBpbmRlbnQpXG4gICAgICBmb3IgKGNvbnN0IGxpbmUgb2YgbGluZXMpIHtcbiAgICAgICAgaWYgKCFsaW5lLnN0YXJ0c1dpdGgoJy0gJykpIGNvbnRpbnVlO1xuICAgICAgICBpZiAobGluZS5zdGFydHNXaXRoKCctIFVwZGF0ZWQgZGVwZW5kZW5jaWVzJykpIGNvbnRpbnVlO1xuXG4gICAgICAgIGNvbnN0IGRlc2MgPSBleHRyYWN0QnVsbGV0RGVzY3JpcHRpb24obGluZSk7XG4gICAgICAgIGlmIChkZXNjICYmIGRlc2MubGVuZ3RoID49IDEwKSB7XG4gICAgICAgICAgY29uc3Qga2V5ID0gZGVzYy50b0xvd2VyQ2FzZSgpLnN1YnN0cmluZygwLCA2MCk7XG4gICAgICAgICAgaWYgKCFoaWdobGlnaHRzLmhhcyhrZXkpKSB7XG4gICAgICAgICAgICBoaWdobGlnaHRzLnNldChrZXksIHsgdHlwZTogY2F0ZWdvcml6ZUhpZ2hsaWdodChkZXNjKSwgdGV4dDogZGVzYyB9KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gMikgRXh0cmFjdCBib2xkIGl0ZW1zIGFzIGhpZ2hsaWdodHMgKG5lc3RlZCBmZWF0dXJlIG5hbWVzKVxuICAgICAgY29uc3QgYm9sZFJlZ2V4ID0gL1xcKlxcKihbXipdKylcXCpcXCovZztcbiAgICAgIGxldCBtYXRjaDtcbiAgICAgIHdoaWxlICgobWF0Y2ggPSBib2xkUmVnZXguZXhlYyhibG9jaykpICE9PSBudWxsKSB7XG4gICAgICAgIGxldCB0ZXh0ID0gbWF0Y2hbMV0udHJpbSgpO1xuICAgICAgICBpZiAodGV4dC5lbmRzV2l0aCgnOicpKSB0ZXh0ID0gdGV4dC5zbGljZSgwLCAtMSk7XG4gICAgICAgIGlmICh0ZXh0LmluY2x1ZGVzKCdAaWZjLWxpdGUvJykpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoU0tJUF9CT0xEX0xPV0VSLmhhcyh0ZXh0LnRvTG93ZXJDYXNlKCkpKSBjb250aW51ZTtcbiAgICAgICAgaWYgKHRleHQubGVuZ3RoIDwgMTApIGNvbnRpbnVlO1xuICAgICAgICBpZiAoaXNJbnRlcm5hbE5hbWUodGV4dCkpIGNvbnRpbnVlO1xuXG4gICAgICAgIGNvbnN0IGtleSA9IHRleHQudG9Mb3dlckNhc2UoKS5zdWJzdHJpbmcoMCwgNjApO1xuICAgICAgICBpZiAoIWhpZ2hsaWdodHMuaGFzKGtleSkpIHtcbiAgICAgICAgICBoaWdobGlnaHRzLnNldChrZXksIHsgdHlwZTogY2F0ZWdvcml6ZUhpZ2hsaWdodCh0ZXh0KSwgdGV4dCB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoaGlnaGxpZ2h0cy5zaXplID4gMCkge1xuICAgICAgICByZWxlYXNlcy5wdXNoKHtcbiAgICAgICAgICB2ZXJzaW9uLFxuICAgICAgICAgIGhpZ2hsaWdodHM6IEFycmF5LmZyb20oaGlnaGxpZ2h0cy52YWx1ZXMoKSkuc2xpY2UoMCwgTUFYX0hJR0hMSUdIVFNfUEVSX1ZFUlNJT04pLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocmVsZWFzZXMubGVuZ3RoID4gMCkge1xuICAgICAgcmVzdWx0LnB1c2goeyBuYW1lOiBwa2dOYW1lLCByZWxlYXNlcyB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzdWx0LnNvcnQoKGEsIGIpID0+IHtcbiAgICBjb25zdCBhVG90YWwgPSBhLnJlbGVhc2VzLnJlZHVjZSgocywgcikgPT4gcyArIHIuaGlnaGxpZ2h0cy5sZW5ndGgsIDApO1xuICAgIGNvbnN0IGJUb3RhbCA9IGIucmVsZWFzZXMucmVkdWNlKChzLCByKSA9PiBzICsgci5oaWdobGlnaHRzLmxlbmd0aCwgMCk7XG4gICAgcmV0dXJuIGJUb3RhbCAtIGFUb3RhbDtcbiAgfSk7XG59XG5cbi8vIENvbGxlY3QgYWxsIHBhY2thZ2UgdmVyc2lvbnNcbmZ1bmN0aW9uIGNvbGxlY3RQYWNrYWdlVmVyc2lvbnMoKTogUGFja2FnZVZlcnNpb25bXSB7XG4gIGNvbnN0IHBhY2thZ2VzRGlyID0gcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzJyk7XG4gIGxldCBkaXJzOiBzdHJpbmdbXTtcbiAgdHJ5IHtcbiAgICBkaXJzID0gZnMucmVhZGRpclN5bmMocGFja2FnZXNEaXIpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gW107XG4gIH1cblxuICBjb25zdCB2ZXJzaW9uczogUGFja2FnZVZlcnNpb25bXSA9IFtdO1xuICBmb3IgKGNvbnN0IGRpciBvZiBkaXJzKSB7XG4gICAgY29uc3QgcGtnUGF0aCA9IHBhdGguam9pbihwYWNrYWdlc0RpciwgZGlyLCAncGFja2FnZS5qc29uJyk7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHBrZ1BhdGgpKSBjb250aW51ZTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGtnID0gSlNPTi5wYXJzZShmcy5yZWFkRmlsZVN5bmMocGtnUGF0aCwgJ3V0Zi04JykpO1xuICAgICAgaWYgKHBrZy5uYW1lICYmIHBrZy52ZXJzaW9uKSB7XG4gICAgICAgIHZlcnNpb25zLnB1c2goeyBuYW1lOiBwa2cubmFtZSwgdmVyc2lvbjogcGtnLnZlcnNpb24gfSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCB7IC8qIHNraXAgdW5yZWFkYWJsZSBwYWNrYWdlcyAqLyB9XG4gIH1cbiAgcmV0dXJuIHZlcnNpb25zLnNvcnQoKGEsIGIpID0+IGEubmFtZS5sb2NhbGVDb21wYXJlKGIubmFtZSkpO1xufVxuXG4vLyBSZWFkIHZlcnNpb24gZnJvbSB2aWV3ZXIgcGFja2FnZS5qc29uIChwcmltYXJ5IGFwcCB2ZXJzaW9uKSB3aXRoIHJvb3QgZmFsbGJhY2tcbmNvbnN0IHZpZXdlclBrZyA9IEpTT04ucGFyc2UoXG4gIGZzLnJlYWRGaWxlU3luYyhwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9wYWNrYWdlLmpzb24nKSwgJ3V0Zi04Jylcbik7XG5jb25zdCByb290UGtnID0gSlNPTi5wYXJzZShcbiAgZnMucmVhZEZpbGVTeW5jKHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlLmpzb24nKSwgJ3V0Zi04Jylcbik7XG5jb25zdCBhcHBWZXJzaW9uID0gdmlld2VyUGtnLnZlcnNpb24gfHwgcm9vdFBrZy52ZXJzaW9uO1xuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbXG4gICAgcmVhY3QoKSxcbiAgICB3YXNtKCksXG4gICAgdG9wTGV2ZWxBd2FpdCgpLFxuICBdLFxuICBkZWZpbmU6IHtcbiAgICBfX0FQUF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KGFwcFZlcnNpb24pLFxuICAgIF9fQlVJTERfREFURV9fOiBKU09OLnN0cmluZ2lmeShuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkpLFxuICAgIF9fUkVMRUFTRV9ISVNUT1JZX186IEpTT04uc3RyaW5naWZ5KHBhcnNlQ2hhbmdlbG9ncygpKSxcbiAgICBfX1BBQ0tBR0VfVkVSU0lPTlNfXzogSlNPTi5zdHJpbmdpZnkoY29sbGVjdFBhY2thZ2VWZXJzaW9ucygpKSxcbiAgfSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS9wYXJzZXInOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvcGFyc2VyL3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS9nZW9tZXRyeSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9nZW9tZXRyeS9zcmMnKSxcbiAgICAgICdAaWZjLWxpdGUvcmVuZGVyZXInOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvcmVuZGVyZXIvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL3F1ZXJ5JzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL3F1ZXJ5L3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS9zZXJ2ZXItY2xpZW50JzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL3NlcnZlci1jbGllbnQvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL3NwYXRpYWwnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvc3BhdGlhbC9zcmMnKSxcbiAgICAgICdAaWZjLWxpdGUvZGF0YSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9kYXRhL3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS9leHBvcnQnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvZXhwb3J0L3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS9jYWNoZSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9jYWNoZS9zcmMnKSxcbiAgICAgICdAaWZjLWxpdGUvaWZjeCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9pZmN4L3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS93YXNtJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL3dhc20vcGtnL2lmYy1saXRlLmpzJyksXG4gICAgICAnQGlmYy1saXRlL3Nkayc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9zZGsvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL2NyZWF0ZSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9jcmVhdGUvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL3NhbmRib3gvc2NoZW1hJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL3NhbmRib3gvc3JjL2JyaWRnZS1zY2hlbWEudHMnKSxcbiAgICAgICdAaWZjLWxpdGUvc2FuZGJveCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9zYW5kYm94L3NyYycpLFxuICAgICAgJ0BpZmMtbGl0ZS9sZW5zJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL2xlbnMvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL211dGF0aW9ucyc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9tdXRhdGlvbnMvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL2JjZic6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9iY2Yvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL2RyYXdpbmctMmQnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvZHJhd2luZy0yZC9zcmMnKSxcbiAgICAgICdAaWZjLWxpdGUvZW5jb2RpbmcnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvZW5jb2Rpbmcvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL2lkcyc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9pZHMvc3JjJyksXG4gICAgICAnQGlmYy1saXRlL2xpc3RzJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL2xpc3RzL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDMwMDAsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0Nyb3NzLU9yaWdpbi1PcGVuZXItUG9saWN5JzogJ3NhbWUtb3JpZ2luJyxcbiAgICAgIC8vIEFsbG93cyB0aGlyZC1wYXJ0eSBuby1jb3JzIHJlc291cmNlcyBsaWtlIFN0cmlwZS5qcyB3aGlsZSBwcmVzZXJ2aW5nXG4gICAgICAvLyBjcm9zcy1vcmlnaW4gaXNvbGF0aW9uIGluIG1vZGVybiBicm93c2Vycy5cbiAgICAgICdDcm9zcy1PcmlnaW4tRW1iZWRkZXItUG9saWN5JzogJ2NyZWRlbnRpYWxsZXNzJyxcbiAgICB9LFxuICAgIGZzOiB7XG4gICAgICBhbGxvdzogWycuLi8uLiddLFxuICAgIH0sXG4gICAgcHJveHk6IHtcbiAgICAgICcvYXBpL2NoYXQnOiB7XG4gICAgICAgIC8vIFNpbmdsZSBBUEkgc291cmNlIG9mIHRydXRoIGxpdmVzIGF0IHJlcG8tcm9vdCBgYXBpL2NoYXQudHNgLlxuICAgICAgICAvLyBGb3IgbG9jYWwgZGV2LCBydW4gYHBucG0gZGV2OmFwaWAgZnJvbSByZXBvIHJvb3QuXG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMScsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICAnL2FwaS9ic2RkJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwczovL2FwaS5ic2RkLmJ1aWxkaW5nc21hcnQub3JnJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICByZXdyaXRlOiAocCkgPT4gcC5yZXBsYWNlKC9eXFwvYXBpXFwvYnNkZC8sICcnKSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlc25leHQnLFxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogNjAwMCxcbiAgfSxcbiAgb3B0aW1pemVEZXBzOiB7XG4gICAgZXhjbHVkZTogW1xuICAgICAgJ0BkdWNrZGIvZHVja2RiLXdhc20nLFxuICAgICAgJ0BpZmMtbGl0ZS93YXNtJyxcbiAgICAgICdwYXJxdWV0LXdhc20nLFxuICAgICAgJ3F1aWNranMtZW1zY3JpcHRlbicsXG4gICAgICAnQGppdGwvcXVpY2tqcy13YXNtZmlsZS1yZWxlYXNlLWFzeW5jaWZ5JyxcbiAgICAgICdlc2J1aWxkLXdhc20nLFxuICAgIF0sXG4gIH0sXG4gIHdvcmtlcjoge1xuICAgIGZvcm1hdDogJ2VzJyxcbiAgICBwbHVnaW5zOiAoKSA9PiBbd2FzbSgpLCB0b3BMZXZlbEF3YWl0KCldLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQWtSLFNBQVMsb0JBQW9CO0FBQy9TLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFDakIsT0FBTyxtQkFBbUI7QUFDMUIsT0FBTyxVQUFVO0FBQ2pCLE9B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
