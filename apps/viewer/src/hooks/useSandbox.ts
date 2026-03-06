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
import { validateScriptPreflight } from '../lib/llm/script-preflight.js';

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

function augmentScriptErrorMessage(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes(`can't access property "location", placement is undefined`)) {
    return `${message}\nLikely cause: a generic \`bim.create.addElement(...)\` payload is using \`Position\` or missing \`Placement.Location\`. Use \`Placement: { Location: [x, y, z] }\` and \`Depth\`.`;
  }
  if (lower.includes(`can't access property "tostring", v is undefined`)) {
    return `${message}\nLikely cause: a required numeric geometry field is missing or undefined (commonly \`Elevation\`, \`Width\`, \`Depth\`, \`Height\`, or \`Thickness\`). Re-check the exact required keys for the create method you called.`;
  }
  if (lower.includes(`'position' is not defined`) || lower.includes(`"position" is not defined`)) {
    return `${message}\nLikely cause: the script contains a malformed BIM object literal or transpilation fallback corrupted a plain JS key like \`Position: [...]\`. Re-send the exact object with explicit key-value pairs.`;
  }
  if (lower.includes('rotated') && lower.includes('window') && lower.includes('wall')) {
    return `${message}\nLikely cause: a standalone \`bim.create.addIfcWindow(...)\` was used where a wall-hosted insert was needed. Use \`bim.create.addIfcWallWindow(...)\` or wall \`Openings\` for wall-aligned placement.`;
  }
  return message;
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

    const preflightErrors = validateScriptPreflight(code);
    if (preflightErrors.length > 0) {
      setError(
        `Preflight validation failed:\n${preflightErrors.map((e) => `- ${e}`).join('\n')}`,
      );
      return null;
    }

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
      const message = augmentScriptErrorMessage(err instanceof Error ? err.message : String(err));

      // If the error is a ScriptError with captured logs, preserve them.
      // Important: setError must run AFTER setResult, because setResult clears
      // scriptLastError in the store.
      if (isScriptError(err)) {
        setResult({
          value: undefined,
          logs: err.logs as ScriptResult['logs'],
          durationMs: err.durationMs,
        });
      }
      setError(message);
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
