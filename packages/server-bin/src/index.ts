// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * @ifc-lite/server-bin
 *
 * Pre-built IFC-Lite server binary - run without Docker or Rust.
 *
 * CLI Usage:
 *   npx @ifc-lite/server-bin
 *   npx ifc-lite-server
 *
 * Programmatic Usage:
 * ```typescript
 * import { runBinary, ensureBinary, getBinaryInfo } from '@ifc-lite/server-bin';
 *
 * // Get binary info
 * const info = getBinaryInfo();
 * console.log(`Platform: ${info.platform.targetTriple}`);
 * console.log(`Cached: ${info.isCached}`);
 *
 * // Ensure binary is downloaded
 * const binaryPath = await ensureBinary();
 *
 * // Run the server
 * const exitCode = await runBinary(['--help']);
 * ```
 */

export {
  runBinary,
  ensureBinary,
  downloadBinary,
  getBinaryPath,
  getBinaryInfo,
  isBinaryCached,
  type ProgressCallback,
} from './binary.js';

export {
  getPlatformInfo,
  getPlatformDescription,
  type Platform,
  type Arch,
  type PlatformInfo,
} from './platform.js';
