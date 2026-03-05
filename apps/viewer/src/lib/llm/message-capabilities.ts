/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FileAttachment, ChatMessage } from './types.js';
import type { StreamMessage, TextContentPart, ImageContentPart } from './stream-client.js';

export interface AttachmentFilterResult {
  accepted: FileAttachment[];
  droppedImages: number;
  droppedFiles: number;
}

export interface StreamBuildResult {
  messages: StreamMessage[];
  droppedInlineImages: number;
  droppedViewportScreenshot: boolean;
}

export function filterAttachmentsForModel(
  attachments: FileAttachment[],
  supportsImages: boolean,
  supportsFileAttachments: boolean,
): AttachmentFilterResult {
  const accepted: FileAttachment[] = [];
  let droppedImages = 0;
  let droppedFiles = 0;

  for (const attachment of attachments) {
    if (attachment.isImage && attachment.imageBase64) {
      if (supportsImages) {
        accepted.push(attachment);
      } else {
        droppedImages += 1;
      }
      continue;
    }

    if (supportsFileAttachments) {
      accepted.push(attachment);
    } else {
      droppedFiles += 1;
    }
  }

  return { accepted, droppedImages, droppedFiles };
}

export function buildStreamMessagesForModel(
  allMessages: ChatMessage[],
  viewportScreenshot: string | null,
  supportsImages: boolean,
): StreamBuildResult {
  let droppedInlineImages = 0;
  let droppedViewportScreenshot = false;

  const messages = allMessages.map((message, idx) => {
    const isLastMessage = idx === allMessages.length - 1;
    const imageAttachments = message.attachments?.filter((a) => a.isImage && a.imageBase64) ?? [];
    const hasViewportShot = isLastMessage && Boolean(viewportScreenshot);

    if (!supportsImages) {
      droppedInlineImages += imageAttachments.length;
      droppedViewportScreenshot = droppedViewportScreenshot || hasViewportShot;
      return { role: message.role as 'user' | 'assistant', content: message.content };
    }

    if (imageAttachments.length === 0 && !hasViewportShot) {
      return { role: message.role as 'user' | 'assistant', content: message.content };
    }

    const parts: Array<TextContentPart | ImageContentPart> = [];
    for (const img of imageAttachments) {
      parts.push({ type: 'image_url', image_url: { url: img.imageBase64! } });
    }
    if (hasViewportShot) {
      parts.push({ type: 'image_url', image_url: { url: viewportScreenshot! } });
      parts.push({
        type: 'text',
        text: `${message.content}\n\n[Attached: current viewport screenshot showing the 3D model state]`,
      });
    } else {
      parts.push({ type: 'text', text: message.content });
    }
    return { role: message.role as 'user' | 'assistant', content: parts };
  });

  return { messages, droppedInlineImages, droppedViewportScreenshot };
}
