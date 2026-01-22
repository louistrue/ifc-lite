/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  entityRefToString,
  stringToEntityRef,
  entityRefEquals,
  type EntityRef,
} from './types.js';

describe('EntityRef utilities', () => {
  describe('entityRefToString', () => {
    it('should convert EntityRef to string', () => {
      const ref: EntityRef = { modelId: 'model-1', expressId: 123 };
      const result = entityRefToString(ref);
      assert.strictEqual(result, 'model-1:123');
    });

    it('should handle zero expressId', () => {
      const ref: EntityRef = { modelId: 'abc', expressId: 0 };
      const result = entityRefToString(ref);
      assert.strictEqual(result, 'abc:0');
    });

    it('should handle large expressIds', () => {
      const ref: EntityRef = { modelId: 'm', expressId: 999999999 };
      const result = entityRefToString(ref);
      assert.strictEqual(result, 'm:999999999');
    });

    it('should handle UUID-style modelIds', () => {
      const ref: EntityRef = {
        modelId: '550e8400-e29b-41d4-a716-446655440000',
        expressId: 42,
      };
      const result = entityRefToString(ref);
      assert.strictEqual(result, '550e8400-e29b-41d4-a716-446655440000:42');
    });
  });

  describe('stringToEntityRef', () => {
    it('should parse string to EntityRef', () => {
      const result = stringToEntityRef('model-1:123');
      assert.strictEqual(result.modelId, 'model-1');
      assert.strictEqual(result.expressId, 123);
    });

    it('should handle zero expressId', () => {
      const result = stringToEntityRef('abc:0');
      assert.strictEqual(result.modelId, 'abc');
      assert.strictEqual(result.expressId, 0);
    });

    it('should handle UUID-style modelIds', () => {
      const result = stringToEntityRef('550e8400-e29b-41d4-a716-446655440000:42');
      assert.strictEqual(result.modelId, '550e8400-e29b-41d4-a716-446655440000');
      assert.strictEqual(result.expressId, 42);
    });

    it('should handle modelIds containing colons by taking first colon as separator', () => {
      // Edge case: modelId with colon - only first colon is separator
      const result = stringToEntityRef('model:with:colons:123');
      assert.strictEqual(result.modelId, 'model');
      // The rest including colons becomes part of what's parsed as expressId
      // "with:colons:123" parsed as Number results in NaN
      assert.ok(Number.isNaN(result.expressId), 'expressId should be NaN when parsing invalid number');
    });
  });

  describe('entityRefToString and stringToEntityRef roundtrip', () => {
    it('should be reversible', () => {
      const original: EntityRef = { modelId: 'test-model', expressId: 456 };
      const str = entityRefToString(original);
      const parsed = stringToEntityRef(str);

      assert.strictEqual(parsed.modelId, original.modelId);
      assert.strictEqual(parsed.expressId, original.expressId);
    });

    it('should handle complex modelIds', () => {
      const original: EntityRef = {
        modelId: '550e8400-e29b-41d4-a716-446655440000',
        expressId: 99999,
      };
      const str = entityRefToString(original);
      const parsed = stringToEntityRef(str);

      assert.strictEqual(parsed.modelId, original.modelId);
      assert.strictEqual(parsed.expressId, original.expressId);
    });
  });

  describe('entityRefEquals', () => {
    it('should return true for equal EntityRefs', () => {
      const a: EntityRef = { modelId: 'model-1', expressId: 123 };
      const b: EntityRef = { modelId: 'model-1', expressId: 123 };
      assert.strictEqual(entityRefEquals(a, b), true);
    });

    it('should return false for different modelIds', () => {
      const a: EntityRef = { modelId: 'model-1', expressId: 123 };
      const b: EntityRef = { modelId: 'model-2', expressId: 123 };
      assert.strictEqual(entityRefEquals(a, b), false);
    });

    it('should return false for different expressIds', () => {
      const a: EntityRef = { modelId: 'model-1', expressId: 123 };
      const b: EntityRef = { modelId: 'model-1', expressId: 456 };
      assert.strictEqual(entityRefEquals(a, b), false);
    });

    it('should return true for both null', () => {
      assert.strictEqual(entityRefEquals(null, null), true);
    });

    it('should return false when only first is null', () => {
      const b: EntityRef = { modelId: 'model-1', expressId: 123 };
      assert.strictEqual(entityRefEquals(null, b), false);
    });

    it('should return false when only second is null', () => {
      const a: EntityRef = { modelId: 'model-1', expressId: 123 };
      assert.strictEqual(entityRefEquals(a, null), false);
    });

    it('should handle zero expressId', () => {
      const a: EntityRef = { modelId: 'model-1', expressId: 0 };
      const b: EntityRef = { modelId: 'model-1', expressId: 0 };
      assert.strictEqual(entityRefEquals(a, b), true);
    });
  });
});
