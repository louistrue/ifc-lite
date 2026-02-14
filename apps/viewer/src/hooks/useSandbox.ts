/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useSandbox — React hook for executing scripts in a QuickJS sandbox.
 *
 * Creates a fresh sandbox context per execution for full isolation.
 * The WASM module is cached across the session (cheap to reuse),
 * but each script runs in a clean context with no leaked state.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useBim } from '../sdk/BimProvider.js';
import { useViewerStore } from '../store/index.js';
import type { Sandbox, ScriptResult, SandboxConfig } from '@ifc-lite/sandbox';

/** Type guard for ScriptError shape (has logs + durationMs) */
function isScriptError(err: unknown): err is { message: string; logs: Array<{ level: string; args: unknown[]; timestamp: number }>; durationMs: number } {
  return (
    err !== null &&
    typeof err === 'object' &&
    'logs' in err &&
    Array.isArray((err as Record<string, unknown>).logs) &&
    'durationMs' in err &&
    typeof (err as Record<string, unknown>).durationMs === 'number'
  );
}

/**
 * Hook that provides a sandbox execution interface.
 *
 * Each execute() call creates a fresh QuickJS context for full isolation —
 * scripts cannot leak global state between runs. The WASM module itself
 * is cached (loaded once per app lifetime, ~1ms context creation overhead).
 */
export function useSandbox(config?: SandboxConfig) {
  const bim = useBim();
  const activeSandboxRef = useRef<Sandbox | null>(null);

  const setExecutionState = useViewerStore((s) => s.setScriptExecutionState);
  const setResult = useViewerStore((s) => s.setScriptResult);
  const setError = useViewerStore((s) => s.setScriptError);

  /** Execute a script in an isolated sandbox context */
  const execute = useCallback(async (code: string): Promise<ScriptResult | null> => {
    setExecutionState('running');
    setError(null);

    let sandbox: Sandbox | null = null;
    try {
      // Create a fresh sandbox for every execution — full isolation
      const { createSandbox } = await import('@ifc-lite/sandbox');
      sandbox = await createSandbox(bim, {
        permissions: { model: true, query: true, viewer: true, mutate: true, lens: true, export: true, ...config?.permissions },
        limits: { timeoutMs: 30_000, ...config?.limits },
      });
      activeSandboxRef.current = sandbox;

      const result = await sandbox.eval(code);
      setResult({
        value: result.value,
        logs: result.logs,
        durationMs: result.durationMs,
      });
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);

      // If the error is a ScriptError with captured logs, preserve them
      if (isScriptError(err)) {
        setResult({
          value: undefined,
          logs: err.logs as ScriptResult['logs'],
          durationMs: err.durationMs,
        });
      }
      return null;
    } finally {
      // Always dispose the sandbox after execution
      if (sandbox) {
        sandbox.dispose();
      }
      if (activeSandboxRef.current === sandbox) {
        activeSandboxRef.current = null;
      }
    }
  }, [bim, config?.permissions, config?.limits, setExecutionState, setResult, setError]);

  /** Reset clears any active sandbox (no-op if none running) */
  const reset = useCallback(() => {
    if (activeSandboxRef.current) {
      activeSandboxRef.current.dispose();
      activeSandboxRef.current = null;
    }
    setExecutionState('idle');
    setResult(null);
    setError(null);
  }, [setExecutionState, setResult, setError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (activeSandboxRef.current) {
        activeSandboxRef.current.dispose();
        activeSandboxRef.current = null;
      }
    };
  }, []);

  return { execute, reset };
}
