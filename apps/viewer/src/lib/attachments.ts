/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ChatMessage, FileAttachment } from './llm/types.js';

function isScriptReadableAttachment(attachment: FileAttachment): boolean {
  if (attachment.isImage) return false;
  return Boolean(
    attachment.textContent
    || attachment.csvData
    || attachment.csvColumns,
  );
}

/**
 * Collect non-image file attachments from chat history and the current composer.
 *
 * Latest attachment wins when the same filename appears multiple times.
 */
export function collectActiveFileAttachments(
  messages: ChatMessage[],
  pendingAttachments: FileAttachment[] = [],
): FileAttachment[] {
  const latestByName = new Map<string, FileAttachment>();

  const remember = (attachment: FileAttachment) => {
    if (!isScriptReadableAttachment(attachment)) return;
    if (latestByName.has(attachment.name)) {
      latestByName.delete(attachment.name);
    }
    latestByName.set(attachment.name, attachment);
  };

  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      remember(attachment);
    }
  }

  for (const attachment of pendingAttachments) {
    remember(attachment);
  }

  return Array.from(latestByName.values());
}
