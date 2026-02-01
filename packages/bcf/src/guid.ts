/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC GUID (IfcGloballyUniqueId) conversion utilities
 *
 * IFC uses a 22-character base64 encoding of 128-bit GUIDs using a custom
 * character set. This module provides conversion between:
 * - Standard UUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 * - IFC GUID format (22 characters)
 *
 * Reference: https://technical.buildingsmart.org/resources/ifcimplementationguidance/ifc-guid/
 */

/**
 * IFC GUID character set (different from standard base64)
 * Characters: 0-9, A-Z, a-z, _, $
 */
const IFC_GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/**
 * Reverse lookup table for IFC GUID characters
 */
const IFC_GUID_CHAR_TO_VALUE: Record<string, number> = {};
for (let i = 0; i < IFC_GUID_CHARS.length; i++) {
  IFC_GUID_CHAR_TO_VALUE[IFC_GUID_CHARS[i]] = i;
}

/**
 * Convert a standard UUID to IFC GUID format (22 characters)
 *
 * @param uuid - UUID string in format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * @returns 22-character IFC GUID string
 */
export function uuidToIfcGuid(uuid: string): string {
  // Remove dashes and convert to uppercase
  const hex = uuid.replace(/-/g, '').toUpperCase();

  if (hex.length !== 32) {
    throw new Error(`Invalid UUID: expected 32 hex characters, got ${hex.length}`);
  }

  // Convert hex string to bytes (16 bytes = 128 bits)
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }

  // Encode to IFC GUID (22 characters)
  // First 2 characters encode first 2 bytes (but only 4 bits from first)
  // Then groups of 3 bytes encode to 4 characters each
  let result = '';

  // First character: high 2 bits of first byte (only 2 bits used, so value 0-3)
  result += IFC_GUID_CHARS[(bytes[0] >> 6) & 0x03];

  // Second character: low 6 bits of first byte
  result += IFC_GUID_CHARS[bytes[0] & 0x3F];

  // Process remaining 15 bytes in groups of 3 (5 groups = 20 characters)
  for (let i = 1; i < 16; i += 3) {
    const b0 = bytes[i] || 0;
    const b1 = bytes[i + 1] || 0;
    const b2 = bytes[i + 2] || 0;

    // Each group of 3 bytes (24 bits) encodes to 4 base64 characters (24 bits)
    result += IFC_GUID_CHARS[(b0 >> 2) & 0x3F];
    result += IFC_GUID_CHARS[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0F)];
    result += IFC_GUID_CHARS[((b1 & 0x0F) << 2) | ((b2 >> 6) & 0x03)];
    result += IFC_GUID_CHARS[b2 & 0x3F];
  }

  return result;
}

/**
 * Convert an IFC GUID to standard UUID format
 *
 * @param ifcGuid - 22-character IFC GUID string
 * @returns UUID string in format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export function ifcGuidToUuid(ifcGuid: string): string {
  if (ifcGuid.length !== 22) {
    throw new Error(`Invalid IFC GUID: expected 22 characters, got ${ifcGuid.length}`);
  }

  // Decode base64 characters to values
  const values: number[] = [];
  for (const char of ifcGuid) {
    const value = IFC_GUID_CHAR_TO_VALUE[char];
    if (value === undefined) {
      throw new Error(`Invalid IFC GUID character: ${char}`);
    }
    values.push(value);
  }

  // Decode to bytes
  const bytes = new Uint8Array(16);

  // First byte: 2 bits from first char + 6 bits from second char
  bytes[0] = ((values[0] & 0x03) << 6) | (values[1] & 0x3F);

  // Remaining bytes: decode groups of 4 characters to 3 bytes
  let byteIndex = 1;
  for (let i = 2; i < 22; i += 4) {
    const v0 = values[i];
    const v1 = values[i + 1];
    const v2 = values[i + 2];
    const v3 = values[i + 3];

    bytes[byteIndex++] = ((v0 & 0x3F) << 2) | ((v1 >> 4) & 0x03);
    bytes[byteIndex++] = ((v1 & 0x0F) << 4) | ((v2 >> 2) & 0x0F);
    bytes[byteIndex++] = ((v2 & 0x03) << 6) | (v3 & 0x3F);
  }

  // Convert bytes to hex and format as UUID
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`.toLowerCase();
}

/**
 * Generate a new random IFC GUID
 *
 * @returns 22-character IFC GUID string
 */
export function generateIfcGuid(): string {
  // Generate a random UUID
  const uuid = generateUuid();
  return uuidToIfcGuid(uuid);
}

/**
 * Generate a new random UUID v4
 *
 * @returns UUID string in format xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
export function generateUuid(): string {
  // Use crypto.randomUUID if available
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback: generate random bytes
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Last resort fallback (not cryptographically secure)
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // Set version (4) and variant (RFC 4122)
  bytes[6] = (bytes[6] & 0x0F) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3F) | 0x80; // Variant RFC 4122

  // Convert to hex string
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  // Format as UUID
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

/**
 * Validate an IFC GUID string
 *
 * @param ifcGuid - String to validate
 * @returns true if valid IFC GUID format
 */
export function isValidIfcGuid(ifcGuid: string): boolean {
  if (typeof ifcGuid !== 'string' || ifcGuid.length !== 22) {
    return false;
  }

  // First character must be 0-3 (only 2 bits used)
  const firstCharValue = IFC_GUID_CHAR_TO_VALUE[ifcGuid[0]];
  if (firstCharValue === undefined || firstCharValue > 3) {
    return false;
  }

  // All other characters must be valid
  for (let i = 1; i < ifcGuid.length; i++) {
    if (IFC_GUID_CHAR_TO_VALUE[ifcGuid[i]] === undefined) {
      return false;
    }
  }

  return true;
}

/**
 * Validate a UUID string
 *
 * @param uuid - String to validate
 * @returns true if valid UUID format
 */
export function isValidUuid(uuid: string): boolean {
  if (typeof uuid !== 'string') {
    return false;
  }

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}
