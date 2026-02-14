/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * useSandbox — React hook for executing scripts in a QuickJS sandbox.
 *
 * Lazily initializes a Sandbox on first execute() call, caches
 * the WASM module across the session, and provides execute/dispose API.
 */

import { useRef, useCallback, useEffect } from 'react';
import { useBim } from '../sdk/BimProvider.js';
import { useViewerStore } from '../store/index.js';
import type { Sandbox, ScriptResult, SandboxConfig } from '@ifc-lite/sandbox';

/**
 * Hook that provides a sandbox execution interface.
 *
 * The sandbox is lazily created on first execute() and disposed on unmount.
 */
export function useSandbox(config?: SandboxConfig) {
  const bim = useBim();
  const sandboxRef = useRef<Sandbox | null>(null);
  const initPromiseRef = useRef<Promise<Sandbox> | null>(null);

  const setExecutionState = useViewerStore((s) => s.setScriptExecutionState);
  const setResult = useViewerStore((s) => s.setScriptResult);
  const setError = useViewerStore((s) => s.setScriptError);

  /** Get or create the sandbox instance */
  const getSandbox = useCallback(async (): Promise<Sandbox> => {
    if (sandboxRef.current) return sandboxRef.current;
    if (initPromiseRef.current) return initPromiseRef.current;

    // Dynamic import to avoid loading QuickJS WASM until needed
    initPromiseRef.current = (async () => {
      const { createSandbox } = await import('@ifc-lite/sandbox');
      const sandbox = await createSandbox(bim, {
        permissions: { model: true, query: true, viewer: true, mutate: true, lens: true, export: true, ...config?.permissions },
        limits: { timeoutMs: 30_000, ...config?.limits },
      });
      sandboxRef.current = sandbox;
      initPromiseRef.current = null;
      return sandbox;
    })();

    return initPromiseRef.current;
  }, [bim, config?.permissions, config?.limits]);

  /** Execute a script and update store with results */
  const execute = useCallback(async (code: string): Promise<ScriptResult | null> => {
    setExecutionState('running');
    setError(null);

    try {
      const sandbox = await getSandbox();
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

      // If the error is from the sandbox (ScriptError), it may have logs
      if (err && typeof err === 'object' && 'logs' in err) {
        const scriptErr = err as { logs: ScriptResult['logs']; durationMs: number };
        setResult({
          value: undefined,
          logs: scriptErr.logs,
          durationMs: scriptErr.durationMs,
        });
      }
      return null;
    }
  }, [getSandbox, setExecutionState, setResult, setError]);

  /** Dispose the sandbox and create a fresh one on next execute */
  const reset = useCallback(() => {
    if (sandboxRef.current) {
      sandboxRef.current.dispose();
      sandboxRef.current = null;
    }
    initPromiseRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sandboxRef.current) {
        sandboxRef.current.dispose();
        sandboxRef.current = null;
      }
    };
  }, []);

  return { execute, reset };
}
