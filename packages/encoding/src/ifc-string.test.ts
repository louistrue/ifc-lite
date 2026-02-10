/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { decodeIfcString } from './ifc-string.js';

describe('decodeIfcString', () => {
  it('returns plain strings unchanged', () => {
    expect(decodeIfcString('Hello World')).toBe('Hello World');
  });

  it('handles null/undefined/empty', () => {
    expect(decodeIfcString('')).toBe('');
    expect(decodeIfcString(null as unknown as string)).toBe(null);
    expect(decodeIfcString(undefined as unknown as string)).toBe(undefined);
  });

  it('decodes \\X2\\ unicode hex sequences', () => {
    // ä = U+00E4
    expect(decodeIfcString('\\X2\\00E4\\X0\\')).toBe('ä');
    // äü (two chars in one sequence)
    expect(decodeIfcString('\\X2\\00E400FC\\X0\\')).toBe('äü');
  });

  it('decodes \\X4\\ 4-byte unicode sequences', () => {
    // 𝄞 = U+1D11E (Musical Symbol G Clef)
    expect(decodeIfcString('\\X4\\0001D11E\\X0\\')).toBe('𝄞');
  });

  it('decodes \\X\\ ISO-8859-1 single byte', () => {
    // ñ = 0xF1 in ISO-8859-1
    expect(decodeIfcString('\\X\\F1')).toBe('ñ');
  });

  it('decodes \\S\\ latin extended', () => {
    // \\S\\X where X.charCodeAt(0) + 128 = result
    // 'a' = 97, 97 + 128 = 225 = á
    expect(decodeIfcString('\\S\\a')).toBe('á');
  });

  it('strips \\P code page switches', () => {
    expect(decodeIfcString('\\PA\\Hello')).toBe('Hello');
  });

  it('decodes mixed encodings in one string', () => {
    expect(decodeIfcString('Br\\X2\\00FC\\X0\\cke')).toBe('Brücke');
  });
});
