/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * File Dialog Service
 *
 * Native file dialog integration for Tauri desktop apps.
 */

import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';

export interface FileInfo {
  path: string;
  name: string;
  size: number;
}

/**
 * Open a native file dialog to select an IFC file
 * @returns File info if a file was selected, null if cancelled
 */
export async function openIfcFileDialog(): Promise<FileInfo | null> {
  try {
    const fileInfo = await invoke<FileInfo | null>('open_ifc_file');
    return fileInfo;
  } catch (error) {
    console.warn('[FileDialog] Failed to open file dialog:', error);
    return null;
  }
}

/**
 * Read file contents from a path
 * @param path File path
 * @returns File contents as Uint8Array
 */
export async function readFileFromPath(path: string): Promise<Uint8Array> {
  return await readFile(path);
}

/**
 * Open file dialog and return file contents
 * Returns a File-like object for compatibility with existing code
 */
export async function openAndReadIfcFile(): Promise<File | null> {
  const fileInfo = await openIfcFileDialog();
  if (!fileInfo) {
    return null;
  }

  try {
    const contents = await readFileFromPath(fileInfo.path);
    // Create a File object for compatibility with existing code
    return new File([contents], fileInfo.name, {
      type: 'application/x-step',
    });
  } catch (error) {
    console.error('[FileDialog] Failed to read file:', error);
    return null;
  }
}
