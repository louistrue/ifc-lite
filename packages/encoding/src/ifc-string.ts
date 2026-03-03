/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Decode IFC STEP encoded strings.
 * Handles:
 * - \X2\XXXX\X0\ - Unicode hex encoding (e.g., \X2\00E4\X0\ -> a with umlaut)
 * - \X4\XXXXXXXX\X0\ - Unicode 4-byte hex for chars outside BMP
 * - \X\XX\ - 8-bit ISO 10646 row 0 hex encoding
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

  // Decode \X\XX\ patterns (8-bit hex in ISO 10646 row 0)
  result = result.replace(/\\X\\([0-9A-Fa-f]{2})\\?/g, (_, hex) => {
    const charCode = parseInt(hex, 16);
    return !isNaN(charCode) ? String.fromCharCode(charCode) : '';
  });

  // Decode \S\X patterns (Latin extended, offset by 128)
  result = result.replace(/\\S\\(.)/g, (_, char) => {
    return String.fromCharCode(char.charCodeAt(0) + 128);
  });

  // Decode \P..\ code page switches (simplified - just remove them)
  result = result.replace(/\\P[A-Z]?\\/g, '');

  // STEP doubles apostrophes inside string literals.
  result = result.replace(/''/g, "'");

  return result;
}

/**
 * Encode plain text for IFC STEP string literals (IFC2x3/IFC4.x conventions).
 *
 * Strategy:
 * - Printable ISO-8859-1 range (32..126) is emitted as-is.
 * - Apostrophes are doubled per STEP string escaping rules.
 * - ISO-8859-1 extended characters (160..255) use short-form \S\X where possible.
 * - Remaining BMP characters use \X2\hhhh\X0\.
 * - Astral characters use \X4\hhhhhhhh\X0\.
 */
export function encodeIfcString(str: string): string {
  if (!str || typeof str !== 'string') return str;

  let result = '';

  for (const char of str) {
    if (char === "'") {
      result += "''";
      continue;
    }

    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    if (codePoint >= 32 && codePoint <= 126) {
      result += char;
      continue;
    }

    // ISO-8859-1 extended area can use the compact \S\X form
    if (codePoint >= 160 && codePoint <= 255) {
      const shifted = codePoint - 128;
      if (shifted >= 32 && shifted <= 126) {
        result += `\\S\\${String.fromCharCode(shifted)}`;
        continue;
      }
    }

    if (codePoint <= 0xffff) {
      result += `\\X2\\${codePoint.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
      continue;
    }

    result += `\\X4\\${codePoint.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }

  return result;
}
