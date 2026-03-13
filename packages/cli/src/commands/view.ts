/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * ifc-lite view <file.ifc> [--port N] [--no-open]
 *
 * Launch an interactive 3D viewer in the browser, connected to the CLI via
 * HTTP + SSE.  The viewer loads, parses, and renders the IFC model using
 * the @ifc-lite/wasm geometry engine (WebGL 2).
 *
 * A REST API on the same port lets external tools (Claude Code, curl, …)
 * send live commands:
 *
 *   curl -X POST http://localhost:PORT/api/command \
 *     -H 'Content-Type: application/json' \
 *     -d '{"action":"colorize","type":"IfcWall","color":[1,0,0,1]}'
 *
 * Supported actions:
 *   colorize       { type, color }         Color entities by IFC type
 *   colorizeEntities { ids, color }       Color specific entities by ID
 *   isolate        { types }              Show only specified types
 *   isolateEntities { ids }               Show only specific entities
 *   highlight      { ids }                Highlight specific express IDs
 *   hideEntities   { ids }                Hide specific entities
 *   showEntities   { ids }                Show specific entities
 *   showall                               Reset visibility
 *   reset                                 Reset all colors + visibility
 *   flyto          { type | ids }         Fly camera to entities
 *   xray           { type, opacity? }     Make a type semi-transparent
 *   section        { axis, position }     Add section plane (axis: x|y|z)
 *   clearSection                          Remove section plane
 *   colorByStorey                         Auto-color by building storey
 *   addGeometry    { ifcContent }         Parse and add new IFC geometry
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fatal, getFlag, hasFlag } from '../output.js';
import { getViewerHtml } from '../viewer-html.js';

/** Valid command actions that the viewer understands */
const VALID_ACTIONS = new Set([
  'colorize', 'isolate', 'xray', 'flyto', 'highlight',
  'colorizeEntities', 'isolateEntities', 'hideEntities', 'showEntities', 'resetColorEntities',
  'section', 'clearSection', 'colorByStorey', 'addGeometry',
  'showall', 'reset', 'picked', 'setView', 'removeCreated', 'camera',
]);

/** Active SSE connections */
const sseClients: Set<ServerResponse> = new Set();

/** Broadcast a command to all connected viewers */
function broadcast(data: Record<string, unknown>): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(payload);
  }
}

/** Read full request body as string */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

/** Resolve the path to @ifc-lite/wasm package */
function resolveWasmDir(): string {
  const require = createRequire(import.meta.url);
  try {
    const pkgJson = require.resolve('@ifc-lite/wasm/package.json');
    return dirname(pkgJson);
  } catch {
    // Fallback: resolve from monorepo root
    return resolve(dirname(import.meta.url.replace('file://', '')), '..', '..', '..', 'wasm');
  }
}

/** MIME types for served files */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.ifc': 'application/octet-stream',
  '.json': 'application/json; charset=utf-8',
};

export async function viewCommand(args: string[]): Promise<void> {
  const noOpen = hasFlag(args, '--no-open');
  const portStr = getFlag(args, '--port');
  const requestedPort = portStr ? parseInt(portStr, 10) : 0;

  // Check for --send mode: send a command to an already-running viewer
  const sendPayload = getFlag(args, '--send');
  if (sendPayload && portStr) {
    const port = parseInt(portStr, 10);
    try {
      const resp = await fetch(`http://localhost:${port}/api/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: sendPayload,
      });
      if (!resp.ok) {
        fatal(`Viewer HTTP ${resp.status}: ${resp.statusText}`);
      }
      const result = (await resp.json()) as { ok: boolean; error?: string };
      process.stdout.write(JSON.stringify(result) + '\n');
      if (!result.ok) {
        process.exitCode = 1;
      }
    } catch (e: unknown) {
      fatal(`Could not connect to viewer at port ${port}: ${(e as Error).message}`);
    }
    return;
  }

  // Find the IFC file argument (optional with --empty)
  const emptyMode = hasFlag(args, '--empty');
  const positional = args.filter(a => !a.startsWith('-') && !['--port', '--send'].includes(args[args.indexOf(a) - 1] ?? ''));
  if (positional.length === 0 && !emptyMode) {
    fatal('Usage: ifc-lite view <file.ifc> [--port N] [--no-open]\n       ifc-lite view --empty --port N');
  }
  const filePath = emptyMode ? null : positional[0];

  // Validate file exists and get size
  let ifcSize = 0;
  if (filePath) {
    try {
      const ifcStat = await stat(filePath);
      ifcSize = ifcStat.size;
    } catch {
      fatal(`File not found: ${filePath}`);
    }
  }

  const fileName = filePath ? basename(filePath) : 'Empty Scene';
  const wasmDir = resolveWasmDir();

  // Read WASM assets
  let wasmBinary: Buffer;
  let wasmJsCached: string;
  try {
    const wasmJs = await readFile(resolve(wasmDir, 'pkg', 'ifc-lite.js'));
    wasmBinary = await readFile(resolve(wasmDir, 'pkg', 'ifc-lite_bg.wasm'));
    // Cache the rewritten JS at startup instead of on every request
    wasmJsCached = wasmJs.toString().replace(
      /new URL\('ifc-lite_bg\.wasm', import\.meta\.url\)/g,
      "new URL('/wasm/ifc-lite_bg.wasm', location.origin)",
    );
  } catch {
    fatal('Could not find @ifc-lite/wasm package. Ensure it is built (pnpm build in packages/wasm).');
  }

  const viewerHtml = getViewerHtml(fileName);

  // Track IFC content created via /api/create for export
  const createdSegments: string[] = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // CORS headers — restrict to localhost origins only
    const origin = req.headers.origin ?? '';
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Routes
    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(viewerHtml);
      return;
    }

    if (path === '/model.ifc' && req.method === 'GET') {
      if (!filePath) {
        // Empty mode — no model to serve
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME['.ifc'],
        'Content-Length': ifcSize.toString(),
      });
      createReadStream(filePath).pipe(res);
      return;
    }

    if (path === '/wasm/ifc-lite.js' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': MIME['.js'] });
      res.end(wasmJsCached);
      return;
    }

    if (path === '/wasm/ifc-lite_bg.wasm' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': MIME['.wasm'],
        'Content-Length': wasmBinary.byteLength.toString(),
      });
      res.end(wasmBinary);
      return;
    }

    // SSE endpoint — CLI pushes commands to browser
    if (path === '/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('data: {"action":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // Command API — external tools send commands to the viewer
    if (path === '/api/command' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const command = JSON.parse(body);
        if (!command.action || !VALID_ACTIONS.has(command.action)) {
          res.writeHead(400, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({
            ok: false,
            error: `Unknown action: ${command.action ?? '(none)'}`,
            validActions: [...VALID_ACTIONS],
          }));
          return;
        }
        broadcast(command);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: true, action: command.action, clients: sseClients.size }));
      } catch (e: unknown) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    // Create element API — POST /api/create
    if (path === '/api/create' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);

        // Support both single element and batch array
        interface CreateRequest {
          type: string;
          params?: Record<string, unknown>;
          storey?: string;
          project?: string;
        }
        const elements: CreateRequest[] = Array.isArray(parsed) ? parsed : [parsed];

        if (elements.length === 0 || !elements[0].type) {
          res.writeHead(400, { 'Content-Type': MIME['.json'] });
          res.end(JSON.stringify({ ok: false, error: 'Missing "type" field' }));
          return;
        }

        // Dynamic import to avoid loading @ifc-lite/create unless needed
        const { IfcCreator } = await import('@ifc-lite/create');
        const { addElement: addEl, ELEMENT_TYPES } = await import('./create.js');

        // Validate all types before creating any
        for (const el of elements) {
          if (!ELEMENT_TYPES.includes(el.type.toLowerCase())) {
            res.writeHead(400, { 'Content-Type': MIME['.json'] });
            res.end(JSON.stringify({ ok: false, error: `Unknown type: ${el.type}`, validTypes: ELEMENT_TYPES }));
            return;
          }
        }

        // Create all elements in a single IFC file
        const creator = new IfcCreator({ Name: elements[0].project ?? 'Live Edit' });
        const storeyId = creator.addIfcBuildingStorey({
          Name: elements[0].storey ?? 'Created',
          Elevation: 0,
        });

        for (const el of elements) {
          addEl(creator, storeyId, el.type, el.params ?? {});
        }
        const result = creator.toIfc();

        // Stream to viewer
        broadcast({ action: 'addGeometry', ifcContent: result.content });
        createdSegments.push(result.content);

        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({
          ok: true,
          count: elements.length,
          entities: result.entities,
          ifcSize: result.stats.fileSize,
        }));
      } catch (e: unknown) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
      }
      return;
    }

    // Clear created geometry — POST /api/clear-created
    if (path === '/api/clear-created' && req.method === 'POST') {
      const count = createdSegments.length;
      createdSegments.length = 0;
      broadcast({ action: 'removeCreated' });
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ ok: true, cleared: count }));
      return;
    }

    // Export created geometry — GET /api/export
    if (path === '/api/export' && req.method === 'GET') {
      if (createdSegments.length === 0) {
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: false, error: 'No geometry has been created yet' }));
        return;
      }
      const combined = createdSegments.join('\n');
      res.writeHead(200, {
        'Content-Type': MIME['.ifc'],
        'Content-Disposition': `attachment; filename="created-${fileName}"`,
        'Content-Length': Buffer.byteLength(combined).toString(),
      });
      res.end(combined);
      return;
    }

    // Viewer status — useful for Claude Code to check if viewer is running
    if (path === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({
        ok: true,
        model: fileName,
        clients: sseClients.size,
        createdSegments: createdSegments.length,
      }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      fatal(`Port ${requestedPort} is already in use. Use --port to pick a different port.`);
    }
    fatal(`Server error: ${err.message}`);
  });

  server.listen(requestedPort, () => {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : requestedPort;
    const url = `http://localhost:${port}`;

    process.stderr.write(`\n  3D Viewer started → ${url}\n`);
    process.stderr.write(`  Model: ${fileName} (${(ifcSize / 1024 / 1024).toFixed(1)} MB)\n`);
    process.stderr.write(`\n  Send commands via REST API:\n`);
    process.stderr.write(`    curl -X POST ${url}/api/command -H 'Content-Type: application/json' \\\n`);
    process.stderr.write(`      -d '{"action":"colorize","type":"IfcWall","color":[1,0,0,1]}'\n`);
    process.stderr.write(`\n  Or use the CLI:\n`);
    process.stderr.write(`    ifc-lite view --port ${port} --send '{"action":"isolate","types":["IfcWall"]}'\n`);
    process.stderr.write(`\n  Press Ctrl+C to stop.\n\n`);

    if (!noOpen) {
      openBrowser(url);
    }

    // Interactive stdin commands
    setupStdinCommands(port);
  });
}

/** Open URL in default browser (cross-platform) */
function openBrowser(url: string): void {
  const { platform } = process;
  let cmd: string;
  if (platform === 'darwin') cmd = `open "${url}"`;
  else if (platform === 'win32') cmd = `start "${url}"`;
  else cmd = `xdg-open "${url}"`;

  import('node:child_process').then(({ exec }) => {
    exec(cmd, () => { /* ignore errors */ });
  });
}

/** Listen for interactive commands on stdin */
function setupStdinCommands(port: number): void {
  if (!process.stdin.isTTY) return;

  process.stderr.write('  Interactive commands: colorize, isolate, view, showall, reset, quit\n');
  process.stderr.write('  > ');

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', (data: string) => {
    const line = data.trim();
    if (!line) {
      process.stderr.write('  > ');
      return;
    }

    if (line === 'quit' || line === 'exit' || line === 'q') {
      process.exit(0);
    }

    const parts = line.split(/\s+/);
    const action = parts[0];

    const COLORS: Record<string, [number, number, number, number]> = {
      red: [1, 0, 0, 1],
      green: [0, 0.7, 0, 1],
      blue: [0, 0.3, 1, 1],
      yellow: [1, 0.9, 0, 1],
      orange: [1, 0.5, 0, 1],
      purple: [0.6, 0.2, 0.8, 1],
      cyan: [0, 0.8, 0.8, 1],
      white: [1, 1, 1, 1],
      pink: [1, 0.4, 0.7, 1],
    };

    let command: Record<string, unknown> | null = null;

    switch (action) {
      case 'colorize': {
        const type = parts[1];
        const colorName = parts[2] ?? 'red';
        const color = COLORS[colorName] ?? [1, 0, 0, 1];
        if (!type) {
          process.stderr.write('  Usage: colorize <IfcType> [color]\n');
        } else {
          command = { action: 'colorize', type, color };
        }
        break;
      }
      case 'isolate': {
        const types = parts.slice(1);
        if (types.length === 0) {
          process.stderr.write('  Usage: isolate <IfcType> [IfcType...]\n');
        } else {
          command = { action: 'isolate', types };
        }
        break;
      }
      case 'xray': {
        const type = parts[1];
        const opacity = parseFloat(parts[2] ?? '0.15');
        if (!type) {
          process.stderr.write('  Usage: xray <IfcType> [opacity]\n');
        } else {
          command = { action: 'xray', type, opacity };
        }
        break;
      }
      case 'highlight': {
        const ids = parts.slice(1).map(Number).filter(n => !isNaN(n));
        if (ids.length === 0) {
          process.stderr.write('  Usage: highlight <id> [id...]\n');
        } else {
          command = { action: 'highlight', ids };
        }
        break;
      }
      case 'flyto': {
        const type = parts[1];
        if (!type) {
          process.stderr.write('  Usage: flyto <IfcType | id>\n');
        } else if (/^\d+$/.test(type)) {
          command = { action: 'flyto', ids: [parseInt(type, 10)] };
        } else {
          command = { action: 'flyto', type };
        }
        break;
      }
      case 'view': {
        const viewName = parts[1];
        if (!viewName) {
          process.stderr.write('  Usage: view <front|back|left|right|top|iso>\n');
        } else {
          command = { action: 'setView', view: viewName };
        }
        break;
      }
      case 'storey':
      case 'colorByStorey':
        command = { action: 'colorByStorey' };
        break;
      case 'section': {
        const axis = parts[1] ?? 'y';
        const rawPos = parts[2] ?? 'center';
        // Pass percentage strings and "center" through to the viewer
        const position = rawPos === 'center' || rawPos.endsWith('%') ? rawPos : parseFloat(rawPos);
        command = { action: 'section', axis, position };
        break;
      }
      case 'clearSection':
      case 'clearsection':
        command = { action: 'clearSection' };
        break;
      case 'clear':
      case 'clearCreated':
        // Use our own REST endpoint to clear server + viewer state
        fetch(`http://localhost:${port}/api/clear-created`, { method: 'POST' }).catch(() => {});
        break;
      case 'showall':
        command = { action: 'showall' };
        break;
      case 'reset':
        command = { action: 'reset' };
        break;
      default:
        // Try parsing as JSON
        try {
          command = JSON.parse(line);
        } catch {
          process.stderr.write(`  Unknown command: ${action}\n`);
          process.stderr.write('  Commands: colorize, isolate, xray, highlight, flyto, view, storey, section, clear, showall, reset, quit\n');
        }
    }

    if (command) {
      broadcast(command);
      process.stderr.write(`  → sent: ${JSON.stringify(command)}\n`);
    }
    process.stderr.write('  > ');
  });
}
