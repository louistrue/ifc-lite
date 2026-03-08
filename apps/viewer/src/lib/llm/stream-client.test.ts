/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { drainSseBuffer, streamChat } from './stream-client.js';

test('drainSseBuffer flushes a final unterminated SSE event', () => {
  const drained = drainSseBuffer('data: {"choices":[{"delta":{"content":"tail"}}]}', true);
  assert.deepEqual(drained.events, ['data: {"choices":[{"delta":{"content":"tail"}}]}']);
  assert.equal(drained.remainder, '');
});

test('streamChat processes the final SSE event even without trailing blank line', async () => {
  const originalFetch = globalThis.fetch;
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"length"}]}',
  ];

  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  }), {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Usage-Limit': '3',
      'X-Usage-Used': '1',
      'X-Usage-Pct': '33',
      'X-Usage-Reset': '1700000000',
    },
  });

  try {
    let fullText = '';
    let finishReason: string | null = null;
    await streamChat({
      proxyUrl: '/api/chat',
      model: 'openai/gpt-free',
      messages: [{ role: 'user', content: 'hi' }],
      onChunk: (text) => { fullText += text; },
      onComplete: (text) => { fullText = text; },
      onFinishReason: (reason) => { finishReason = reason; },
      onError: (error) => { throw error; },
    });

    assert.equal(fullText, 'Hello world');
    assert.equal(finishReason, 'length');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
