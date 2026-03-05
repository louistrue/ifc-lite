/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, FileAttachment } from './types.js';
import { buildStreamMessagesForModel, filterAttachmentsForModel } from './message-capabilities.js';

function makeImageAttachment(name: string): FileAttachment {
  return {
    name,
    type: 'image/png',
    size: 100,
    imageBase64: 'data:image/png;base64,abc',
    isImage: true,
  };
}

function makeFileAttachment(name: string): FileAttachment {
  return {
    name,
    type: 'text/csv',
    size: 20,
    textContent: 'a,b\n1,2',
  };
}

test('filters attachments by model capabilities', () => {
  const attachments = [makeImageAttachment('img.png'), makeFileAttachment('data.csv')];
  const filtered = filterAttachmentsForModel(attachments, false, true);

  assert.equal(filtered.accepted.length, 1);
  assert.equal(filtered.accepted[0].name, 'data.csv');
  assert.equal(filtered.droppedImages, 1);
  assert.equal(filtered.droppedFiles, 0);
});

test('buildStreamMessagesForModel drops unsupported image payload parts', () => {
  const messages: ChatMessage[] = [
    {
      id: 'm1',
      role: 'user',
      content: 'Hello',
      createdAt: Date.now(),
      attachments: [makeImageAttachment('img1.png')],
    },
  ];

  const result = buildStreamMessagesForModel(messages, 'data:image/png;base64,viewport', false);
  assert.equal(result.droppedInlineImages, 1);
  assert.equal(result.droppedViewportScreenshot, true);
  assert.equal(typeof result.messages[0].content, 'string');
  assert.equal(result.messages[0].content, 'Hello');
});

test('buildStreamMessagesForModel keeps image payload parts when supported', () => {
  const messages: ChatMessage[] = [
    {
      id: 'm1',
      role: 'user',
      content: 'Show this',
      createdAt: Date.now(),
      attachments: [makeImageAttachment('img1.png')],
    },
  ];

  const result = buildStreamMessagesForModel(messages, null, true);
  assert.equal(result.droppedInlineImages, 0);
  assert.equal(result.droppedViewportScreenshot, false);
  assert.ok(Array.isArray(result.messages[0].content));
  const parts = result.messages[0].content as Array<{ type: string }>;
  assert.equal(parts[0].type, 'image_url');
});
