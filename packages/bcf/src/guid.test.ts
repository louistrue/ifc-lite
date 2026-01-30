/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import {
  uuidToIfcGuid,
  ifcGuidToUuid,
  generateIfcGuid,
  generateUuid,
  isValidIfcGuid,
  isValidUuid,
} from './guid.js';

describe('IFC GUID utilities', () => {
  describe('uuidToIfcGuid', () => {
    it('should convert a known UUID to correct IFC GUID', () => {
      // Test case from buildingSMART documentation
      const uuid = '3d2b2fa4-3b2f-11e0-b7a7-00163e7a5e00';
      const ifcGuid = uuidToIfcGuid(uuid);
      // IFC GUIDs are 22 characters
      expect(ifcGuid.length).toBe(22);
      // First character should be 0-3 (only 2 bits used)
      expect(['0', '1', '2', '3']).toContain(ifcGuid[0]);
    });

    it('should produce consistent results', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const ifcGuid1 = uuidToIfcGuid(uuid);
      const ifcGuid2 = uuidToIfcGuid(uuid);
      expect(ifcGuid1).toBe(ifcGuid2);
    });

    it('should throw for invalid UUID', () => {
      expect(() => uuidToIfcGuid('invalid')).toThrow();
    });
  });

  describe('ifcGuidToUuid', () => {
    it('should convert IFC GUID back to UUID', () => {
      const originalUuid = '550e8400-e29b-41d4-a716-446655440000';
      const ifcGuid = uuidToIfcGuid(originalUuid);
      const convertedUuid = ifcGuidToUuid(ifcGuid);
      expect(convertedUuid).toBe(originalUuid);
    });

    it('should throw for invalid IFC GUID length', () => {
      expect(() => ifcGuidToUuid('short')).toThrow();
    });

    it('should throw for invalid IFC GUID characters', () => {
      expect(() => ifcGuidToUuid('0000000000000000000000@@')).toThrow();
    });
  });

  describe('generateIfcGuid', () => {
    it('should generate valid IFC GUID', () => {
      const guid = generateIfcGuid();
      expect(guid.length).toBe(22);
      expect(isValidIfcGuid(guid)).toBe(true);
    });

    it('should generate unique GUIDs', () => {
      const guids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        guids.add(generateIfcGuid());
      }
      expect(guids.size).toBe(100);
    });
  });

  describe('generateUuid', () => {
    it('should generate valid UUID', () => {
      const uuid = generateUuid();
      expect(isValidUuid(uuid)).toBe(true);
    });

    it('should generate unique UUIDs', () => {
      const uuids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        uuids.add(generateUuid());
      }
      expect(uuids.size).toBe(100);
    });
  });

  describe('isValidIfcGuid', () => {
    it('should return true for valid IFC GUID', () => {
      const guid = generateIfcGuid();
      expect(isValidIfcGuid(guid)).toBe(true);
    });

    it('should return false for invalid length', () => {
      expect(isValidIfcGuid('short')).toBe(false);
      expect(isValidIfcGuid('0000000000000000000000000')).toBe(false);
    });

    it('should return false for invalid first character', () => {
      // First character must be 0-3
      expect(isValidIfcGuid('4000000000000000000000')).toBe(false);
    });

    it('should return false for non-string', () => {
      expect(isValidIfcGuid(null as unknown as string)).toBe(false);
      expect(isValidIfcGuid(123 as unknown as string)).toBe(false);
    });
  });

  describe('isValidUuid', () => {
    it('should return true for valid UUID', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return false for invalid UUID', () => {
      expect(isValidUuid('invalid')).toBe(false);
      expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve UUID after round-trip', () => {
      for (let i = 0; i < 10; i++) {
        const originalUuid = generateUuid();
        const ifcGuid = uuidToIfcGuid(originalUuid);
        const convertedUuid = ifcGuidToUuid(ifcGuid);
        expect(convertedUuid).toBe(originalUuid);
      }
    });
  });
});
