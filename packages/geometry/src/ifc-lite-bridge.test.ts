/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const wasmMocks = vi.hoisted(() => {
  const parseMeshes = vi.fn();

  class MockIfcAPI {
    parseMeshes(content: string) {
      return parseMeshes(content);
    }
  }

  return {
    init: vi.fn(async () => undefined),
    parseMeshes,
    MockIfcAPI,
  };
});

vi.mock('@ifc-lite/wasm', () => ({
  default: wasmMocks.init,
  IfcAPI: wasmMocks.MockIfcAPI,
}));

import { IfcLiteBridge } from './ifc-lite-bridge.js';

describe('IfcLiteBridge', () => {
  beforeEach(() => {
    wasmMocks.init.mockClear();
    wasmMocks.parseMeshes.mockReset();
  });

  it('blocks in-process reinitialization after a fatal wasm runtime error', async () => {
    const bridge = new IfcLiteBridge();
    await bridge.init();

    wasmMocks.parseMeshes.mockImplementationOnce(() => {
      throw new WebAssembly.RuntimeError('panic');
    });

    expect(() => bridge.parseMeshes('broken ifc')).toThrow(WebAssembly.RuntimeError);
    await expect(bridge.init()).rejects.toThrow(
      'IFC-Lite WASM cannot recover from a fatal runtime error within the same document lifetime.',
    );
    expect(wasmMocks.init).toHaveBeenCalledTimes(1);
  });
});
