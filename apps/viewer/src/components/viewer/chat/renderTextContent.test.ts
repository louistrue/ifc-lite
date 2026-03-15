/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTextContent } from './renderTextContent';

test('escapes html tags and script payloads', () => {
  const rendered = renderTextContent('<img src=x onerror=alert(1)><script>alert("xss")</script>');
  assert.ok(rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(rendered.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
  assert.ok(!rendered.includes('<script>'));
  assert.ok(!rendered.includes('<img'));
});

test('preserves allowed inline markdown after escaping', () => {
  const rendered = renderTextContent('**bold** *italic* `const x = 1`');
  assert.equal(
    rendered,
    '<strong>bold</strong> <em>italic</em> <code class="bg-muted px-1 py-0.5 rounded text-xs font-mono">const x = 1</code>',
  );
});
