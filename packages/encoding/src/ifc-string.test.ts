/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import { decodeIfcString, encodeIfcString } from './ifc-string.js';

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

  it('decodes \\X\\ 8-bit hex sequences with and without trailing slash', () => {
    // ñ = 0xF1 in ISO 10646 row 0
    expect(decodeIfcString('\\X\\F1')).toBe('ñ');
    expect(decodeIfcString('\\X\\F1\\')).toBe('ñ');
  });

  it('decodes \\S\\ latin extended', () => {
    // \S\D = 68 + 128 = 196 = Ä
    expect(decodeIfcString('\\S\\D')).toBe('Ä');
  });

  it('strips \\P code page switches', () => {
    expect(decodeIfcString('\\PA\\Hello')).toBe('Hello');
  });

  it('decodes mixed encodings in one string', () => {
    expect(decodeIfcString('Br\\X2\\00FC\\X0\\cke')).toBe('Brücke');
  });

  it('handles documented IFC umlaut examples', () => {
    expect(decodeIfcString('\\S\\D')).toBe('Ä');
    expect(decodeIfcString('\\PA\\\\S\\D')).toBe('Ä');
    expect(decodeIfcString('\\X\\C4')).toBe('Ä');
    expect(decodeIfcString('\\X2\\00C4\\X0\\')).toBe('Ä');
  });
});

describe('encodeIfcString', () => {
  it('returns plain strings unchanged', () => {
    expect(encodeIfcString('Hello World')).toBe('Hello World');
  });

  it('encodes apostrophes as doubled quotes', () => {
    expect(encodeIfcString("O'Brien")).toBe("O''Brien");
  });

  it('encodes latin-1 extension with compact \\S\\ form', () => {
    expect(encodeIfcString('Ä')).toBe('\\S\\D');
  });

  it('encodes BMP unicode with \\X2\\', () => {
    expect(encodeIfcString('Ω')).toBe('\\X2\\03A9\\X0\\');
  });

  it('encodes astral unicode with \\X4\\', () => {
    expect(encodeIfcString('𝄞')).toBe('\\X4\\0001D11E\\X0\\');
  });

  it('round-trips mixed strings', () => {
    const value = "Brücke Ω 𝄞 O'Brien";
    expect(decodeIfcString(encodeIfcString(value))).toBe(value);
  });
});
