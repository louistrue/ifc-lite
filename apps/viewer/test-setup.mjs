/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Polyfill browser globals required by @ifc-lite/wasm worker helpers
// which execute `waitForMsgType(self, ...)` at import time.
// In Node.js `self` is undefined and `globalThis` lacks `addEventListener`,
// so we provide a no-op stub that satisfies the worker bootstrap code.
if (typeof globalThis.self === 'undefined') {
  globalThis.self = /** @type {any} */ ({
    addEventListener() {},
    removeEventListener() {},
    postMessage() {},
  });
}
