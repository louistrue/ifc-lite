/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Sandbox — QuickJS-in-WASM script execution environment.
 *
 * Architecture:
 * - One WASM module loaded per app lifetime (shared across sandboxes)
 * - Each sandbox creates a fresh QuickJS context (cheap — a few KB)
 * - The `bim` API is built inside the context via bridge.ts
 * - Scripts run synchronously inside QuickJS
 * - Memory and CPU limits enforced per-context
 * - TypeScript is transpiled to JS before execution (type-stripping)
 */

import { getQuickJS, type QuickJSWASMModule, type QuickJSContext, type QuickJSRuntime } from 'quickjs-emscripten';
import type { BimContext } from '@ifc-lite/sdk';
import type { SandboxConfig, ScriptResult, LogEntry } from './types.js';
import { DEFAULT_LIMITS, DEFAULT_PERMISSIONS } from './types.js';
import { buildBridge } from './bridge.js';
import { transpileTypeScript } from './transpile.js';

/** Cached WASM module — loaded once, reused for all sandboxes */
let cachedModule: QuickJSWASMModule | null = null;

async function getModule(): Promise<QuickJSWASMModule> {
  if (!cachedModule) {
    cachedModule = await getQuickJS();
  }
  return cachedModule;
}

export class Sandbox {
  private runtime: QuickJSRuntime | null = null;
  private vm: QuickJSContext | null = null;
  private logs: LogEntry[] = [];
  private config: Required<SandboxConfig>;

  constructor(
    private sdk: BimContext,
    config: SandboxConfig = {},
  ) {
    this.config = {
      permissions: { ...DEFAULT_PERMISSIONS, ...config.permissions },
      limits: { ...DEFAULT_LIMITS, ...config.limits },
    };
  }

  /** Initialize the sandbox (loads WASM module if not cached) */
  async init(): Promise<void> {
    const module = await getModule();
    this.runtime = module.newRuntime();

    // Apply resource limits
    this.runtime.setMemoryLimit(this.config.limits.memoryBytes ?? DEFAULT_LIMITS.memoryBytes);
    this.runtime.setMaxStackSize(this.config.limits.maxStackBytes ?? DEFAULT_LIMITS.maxStackBytes);

    // CPU limit via interrupt handler
    const timeoutMs = this.config.limits.timeoutMs ?? DEFAULT_LIMITS.timeoutMs;
    let startTime = 0;
    this.runtime.setInterruptHandler(() => {
      if (startTime > 0 && Date.now() - startTime > timeoutMs) {
        return true; // Interrupt execution
      }
      return false;
    });

    this.vm = this.runtime.newContext();

    // Build the bim API inside the sandbox
    const { logs } = buildBridge(this.vm, this.sdk, this.config.permissions);
    this.logs = logs;
  }

  /**
   * Execute a script in the sandbox.
   *
   * Supports both JavaScript and TypeScript (TypeScript is type-stripped before execution).
   */
  async eval(code: string, options?: { filename?: string; typescript?: boolean }): Promise<ScriptResult> {
    if (!this.vm) {
      throw new Error('Sandbox not initialized. Call init() first.');
    }

    // Clear previous logs
    this.logs.length = 0;

    // Transpile TypeScript if needed
    let jsCode = code;
    if (options?.typescript !== false && this.looksLikeTypeScript(code)) {
      jsCode = await transpileTypeScript(code);
    }

    const startTime = Date.now();

    const result = this.vm.evalCode(jsCode, options?.filename ?? 'script.js');
    const durationMs = Date.now() - startTime;

    if (result.error) {
      const errorData = this.vm.dump(result.error);
      result.error.dispose();
      throw new ScriptError(
        typeof errorData === 'object' && errorData !== null && 'message' in errorData
          ? String(errorData.message)
          : String(errorData),
        this.logs,
        durationMs,
      );
    }

    const value = this.vm.dump(result.value);
    result.value.dispose();

    return {
      value,
      logs: [...this.logs],
      durationMs,
    };
  }

  /** Dispose the sandbox and free WASM memory */
  dispose(): void {
    if (this.vm) {
      this.vm.dispose();
      this.vm = null;
    }
    if (this.runtime) {
      this.runtime.dispose();
      this.runtime = null;
    }
  }

  /** Simple heuristic: does the code contain TypeScript syntax? */
  private looksLikeTypeScript(code: string): boolean {
    return /(?::\s*(?:string|number|boolean|void|any|unknown|never)\b)|(?:interface\s+\w)|(?:<\w+>)/.test(code);
  }
}

/** Error thrown when a sandboxed script fails */
export class ScriptError extends Error {
  constructor(
    message: string,
    public readonly logs: LogEntry[],
    public readonly durationMs: number,
  ) {
    super(message);
    this.name = 'ScriptError';
  }
}

/**
 * Create and initialize a sandbox.
 *
 * Usage:
 *   const sandbox = await createSandbox(bim, { permissions: { mutate: true } })
 *   const result = await sandbox.eval('bim.query.byType("IfcWall")')
 *   sandbox.dispose()
 */
export async function createSandbox(
  sdk: BimContext,
  config?: SandboxConfig,
): Promise<Sandbox> {
  const sandbox = new Sandbox(sdk, config);
  await sandbox.init();
  return sandbox;
}
