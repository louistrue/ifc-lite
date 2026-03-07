/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FileAttachmentInfo, FilesBackendMethods } from '@ifc-lite/sdk';
import { collectActiveFileAttachments } from '@/lib/attachments';
import type { StoreApi } from './types.js';

function getAttachments(store: StoreApi) {
  const state = store.getState();
  return collectActiveFileAttachments(state.chatMessages, state.chatAttachments);
}

export function createFilesAdapter(store: StoreApi): FilesBackendMethods {
  return {
    list(): FileAttachmentInfo[] {
      return getAttachments(store).map((attachment) => ({
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        rowCount: attachment.csvData?.length,
        columns: attachment.csvColumns,
        hasTextContent: typeof attachment.textContent === 'string',
      }));
    },
    text(name: string): string | null {
      const attachment = getAttachments(store).find((item) => item.name === name);
      return attachment?.textContent ?? null;
    },
    csv(name: string): Record<string, string>[] | null {
      const attachment = getAttachments(store).find((item) => item.name === name);
      return attachment?.csvData ?? null;
    },
    csvColumns(name: string): string[] {
      const attachment = getAttachments(store).find((item) => item.name === name);
      return attachment?.csvColumns ?? [];
    },
  };
}
