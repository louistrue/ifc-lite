/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IFC_SERVER_URL?: string;
  readonly VITE_SERVER_URL?: string;
  readonly VITE_USE_SERVER?: string;
  // Add more env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
