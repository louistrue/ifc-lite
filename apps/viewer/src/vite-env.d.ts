/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IFC_SERVER_URL?: string;
  readonly VITE_SERVER_URL?: string;
  readonly VITE_USE_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build-time constants injected by Vite define
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;
declare const __RELEASE_HISTORY__: Array<{
  version: string;
  highlights: Array<{ type: 'feature' | 'fix' | 'perf'; text: string }>;
}>;
