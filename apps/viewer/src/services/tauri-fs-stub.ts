/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export async function readFile(_path: string): Promise<Uint8Array> {
  throw new Error('Tauri file system API is unavailable in the browser benchmark build');
}
