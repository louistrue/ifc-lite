/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { DEFAULT_PERMISSIONS, DEFAULT_LIMITS } from '../../sandbox/src/types.js';
import type { SandboxLimits, SandboxPermissions, ScriptResult } from './namespaces/sandbox.js';

describe('SandboxNamespace parity', () => {
  it('accepts runtime default permissions including files access', () => {
    const permissions: SandboxPermissions = DEFAULT_PERMISSIONS;
    expect(permissions.viewer).toBe(true);
    expect(permissions.export).toBe(true);
    expect(permissions.files).toBe(true);
  });

  it('accepts runtime default limits unchanged', () => {
    const limits: SandboxLimits = DEFAULT_LIMITS;
    expect(limits).toEqual(DEFAULT_LIMITS);
  });

  it('keeps log timestamps in the SDK-facing ScriptResult shape', () => {
    const result: ScriptResult = {
      value: 1,
      logs: [{ level: 'log', args: ['hello'], timestamp: 123 }],
      durationMs: 4,
    };
    expect(result.logs[0]?.timestamp).toBe(123);
  });
});
