/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { BimBackend, FileAttachmentInfo } from '../types.js';

/** bim.files — Uploaded text/CSV attachments available to scripts */
export class FilesNamespace {
  constructor(private backend: BimBackend) {}

  /** List uploaded file attachments available to scripts */
  list(): FileAttachmentInfo[] {
    return this.backend.files.list();
  }

  /** Get the raw text content of an uploaded attachment */
  text(name: string): string | null {
    return this.backend.files.text(name);
  }

  /** Get parsed CSV rows from an uploaded CSV/TSV attachment */
  csv(name: string): Record<string, string>[] | null {
    return this.backend.files.csv(name);
  }

  /** Get CSV column names from an uploaded CSV/TSV attachment */
  csvColumns(name: string): string[] {
    return this.backend.files.csvColumns(name);
  }
}
