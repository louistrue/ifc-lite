/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Decode IFC STEP encoded strings.
 * Handles:
 * - \X2\XXXX\X0\ - Unicode hex encoding (e.g., \X2\00E4\X0\ -> a with umlaut)
 * - \X4\XXXXXXXX\X0\ - Unicode 4-byte hex for chars outside BMP
 * - \X\XX\ - ISO-8859-1 hex encoding
 * - \S\X - Extended ASCII with escape
 * - \P..\ - Code page switches (stripped)
 */
export function decodeIfcString(str: string): string {
  if (!str || typeof str !== 'string') return str;

  let result = str;

  // Decode \X2\XXXX\X0\ patterns (Unicode 2-byte hex, can have multiple chars)
  result = result.replace(/\\X2\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex) => {
    let decoded = '';
    for (let i = 0; i < hex.length; i += 4) {
      const charCode = parseInt(hex.substring(i, i + 4), 16);
      if (!isNaN(charCode)) {
        decoded += String.fromCharCode(charCode);
      }
    }
    return decoded;
  });

  // Decode \X4\XXXXXXXX\X0\ patterns (Unicode 4-byte hex for chars outside BMP)
  result = result.replace(/\\X4\\([0-9A-Fa-f]+)\\X0\\/g, (_, hex) => {
    let decoded = '';
    for (let i = 0; i < hex.length; i += 8) {
      const codePoint = parseInt(hex.substring(i, i + 8), 16);
      if (!isNaN(codePoint)) {
        decoded += String.fromCodePoint(codePoint);
      }
    }
    return decoded;
  });

  // Decode \X\XX\ patterns (ISO-8859-1 single byte)
  result = result.replace(/\\X\\([0-9A-Fa-f]{2})/g, (_, hex) => {
    const charCode = parseInt(hex, 16);
    return !isNaN(charCode) ? String.fromCharCode(charCode) : '';
  });

  // Decode \S\X patterns (Latin extended, offset by 128)
  result = result.replace(/\\S\\(.)/g, (_, char) => {
    return String.fromCharCode(char.charCodeAt(0) + 128);
  });

  // Decode \P..\ code page switches (simplified - just remove them)
  result = result.replace(/\\P[A-Z]?\\/g, '');

  return result;
}
