/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { parsePropertyValue } from './property-value.js';

describe('parsePropertyValue', () => {
  it('returns em-dash for null/undefined', () => {
    expect(parsePropertyValue(null).displayValue).toBe('\u2014');
    expect(parsePropertyValue(undefined).displayValue).toBe('\u2014');
  });

  it('resolves boolean enums', () => {
    expect(parsePropertyValue('.T.')).toEqual({ displayValue: 'True', ifcType: 'Boolean' });
    expect(parsePropertyValue('.F.')).toEqual({ displayValue: 'False', ifcType: 'Boolean' });
    expect(parsePropertyValue('.U.')).toEqual({ displayValue: 'Unknown', ifcType: 'Boolean' });
  });

  it('resolves typed value arrays', () => {
    const result = parsePropertyValue(['IFCIDENTIFIER', '100 x 150mm']);
    expect(result.displayValue).toBe('100 x 150mm');
    expect(result.ifcType).toBe('Identifier');
  });

  it('resolves typed boolean arrays', () => {
    const result = parsePropertyValue(['IFCBOOLEAN', '.T.']);
    expect(result.displayValue).toBe('True');
    expect(result.ifcType).toBe('Boolean');
  });

  it('resolves "IFCTYPE,value" string patterns', () => {
    const result = parsePropertyValue('IFCLABEL,Concrete');
    expect(result.displayValue).toBe('Concrete');
    expect(result.ifcType).toBe('Label');
  });

  it('resolves "IFCTYPE,.T." string pattern as boolean', () => {
    const result = parsePropertyValue('IFCBOOLEAN,.T.');
    expect(result.displayValue).toBe('True');
    expect(result.ifcType).toBe('Boolean');
  });

  it('returns em-dash for empty typed values', () => {
    const result = parsePropertyValue('IFCLABEL,');
    expect(result.displayValue).toBe('\u2014');
    expect(result.ifcType).toBe('Label');
  });

  it('handles native booleans', () => {
    expect(parsePropertyValue(true)).toEqual({ displayValue: 'True', ifcType: 'Boolean' });
    expect(parsePropertyValue(false)).toEqual({ displayValue: 'False', ifcType: 'Boolean' });
  });

  it('formats numbers', () => {
    const result = parsePropertyValue(42);
    expect(result.displayValue).toBeTruthy();
    expect(result.ifcType).toBeUndefined();
  });

  it('decodes IFC-encoded strings', () => {
    const result = parsePropertyValue('Br\\X2\\00FC\\X0\\cke');
    expect(result.displayValue).toBe('Brücke');
  });

  it('handles plain strings', () => {
    expect(parsePropertyValue('hello').displayValue).toBe('hello');
  });
});
