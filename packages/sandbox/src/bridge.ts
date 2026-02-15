/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Bridge — exposes the `bim` API object inside the QuickJS sandbox.
 *
 * Architecture (Figma-inspired):
 * - No data lives inside the sandbox
 * - Every `bim.*` call crosses the WASM boundary to the host
 * - Entity objects in the sandbox are plain data { ref, name, type, ... }
 * - Property/quantity access triggers on-demand extraction on the host
 *
 * All namespaces (model, query, viewer, mutate, lens, export) are built
 * from declarative schemas in bridge-schema.ts.
 */

import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten';
import type { BimContext } from '@ifc-lite/sdk';
import type { SandboxPermissions, LogEntry } from './types.js';
import { DEFAULT_PERMISSIONS } from './types.js';
import { buildSchemaNamespaces } from './bridge-schema.js';

/**
 * Build the `bim` API object inside the QuickJS VM.
 * Returns captured log entries from console.* calls.
 */
export function buildBridge(
  vm: QuickJSContext,
  sdk: BimContext,
  permissions: SandboxPermissions = {},
): { logs: LogEntry[] } {
  const perms = { ...DEFAULT_PERMISSIONS, ...permissions } as Required<SandboxPermissions>;
  const logs: LogEntry[] = [];

  // ── console.log / warn / error / info ──────────────────────
  buildConsole(vm, logs);

  // ── bim global ─────────────────────────────────────────────
  const bimHandle = vm.newObject();

  // All namespaces are schema-driven (model, query, viewer, mutate, lens, export)
  buildSchemaNamespaces(vm, bimHandle, sdk, perms);

  vm.setProp(vm.global, 'bim', bimHandle);
  bimHandle.dispose();

  return { logs };
}

// ── Console ──────────────────────────────────────────────────

function buildConsole(vm: QuickJSContext, logs: LogEntry[]): void {
  const consoleHandle = vm.newObject();

  for (const level of ['log', 'warn', 'error', 'info'] as const) {
    const fn = vm.newFunction(level, (...args: QuickJSHandle[]) => {
      const nativeArgs = args.map(a => vm.dump(a));
      logs.push({ level, args: nativeArgs, timestamp: Date.now() });
    });
    vm.setProp(consoleHandle, level, fn);
    fn.dispose();
  }

  vm.setProp(vm.global, 'console', consoleHandle);
  consoleHandle.dispose();
}
