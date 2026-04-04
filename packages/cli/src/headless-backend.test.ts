/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect } from 'vitest';
import {
  expandTypes,
  isProductType,
  normalizeBooleanValue,
  normalizePropertyValue,
} from './headless-backend.js';

describe('expandTypes', () => {
  it('returns the type itself in uppercase', () => {
    expect(expandTypes(['IfcWall'])).toContain('IFCWALL');
  });

  it('expands IfcWall to include IFCWALLSTANDARDCASE', () => {
    const result = expandTypes(['IfcWall']);
    expect(result).toContain('IFCWALL');
    expect(result).toContain('IFCWALLSTANDARDCASE');
    expect(result).toContain('IFCWALLELEMENTEDCASE');
  });

  it('expands IfcBeam to include IFCBEAMSTANDARDCASE', () => {
    const result = expandTypes(['IfcBeam']);
    expect(result).toContain('IFCBEAM');
    expect(result).toContain('IFCBEAMSTANDARDCASE');
  });

  it('expands IfcColumn to include IFCCOLUMNSTANDARDCASE', () => {
    const result = expandTypes(['IfcColumn']);
    expect(result).toContain('IFCCOLUMN');
    expect(result).toContain('IFCCOLUMNSTANDARDCASE');
  });

  it('expands IfcDoor subtypes', () => {
    const result = expandTypes(['IfcDoor']);
    expect(result).toContain('IFCDOOR');
    expect(result).toContain('IFCDOORSTANDARDCASE');
  });

  it('expands IfcWindow subtypes', () => {
    const result = expandTypes(['IfcWindow']);
    expect(result).toContain('IFCWINDOW');
    expect(result).toContain('IFCWINDOWSTANDARDCASE');
  });

  it('expands IfcSlab subtypes', () => {
    const result = expandTypes(['IfcSlab']);
    expect(result).toContain('IFCSLAB');
    expect(result).toContain('IFCSLABSTANDARDCASE');
    expect(result).toContain('IFCSLABELEMENTEDCASE');
  });

  it('expands IfcMember subtypes', () => {
    const result = expandTypes(['IfcMember']);
    expect(result).toContain('IFCMEMBER');
    expect(result).toContain('IFCMEMBERSTANDARDCASE');
  });

  it('expands IfcPlate subtypes', () => {
    const result = expandTypes(['IfcPlate']);
    expect(result).toContain('IFCPLATE');
    expect(result).toContain('IFCPLATESTANDARDCASE');
  });

  it('expands IfcOpeningElement subtypes', () => {
    const result = expandTypes(['IfcOpeningElement']);
    expect(result).toContain('IFCOPENINGELEMENT');
    expect(result).toContain('IFCOPENINGSTANDARDCASE');
  });

  it('handles types without subtypes', () => {
    const result = expandTypes(['IfcRoof']);
    expect(result).toEqual(['IFCROOF']);
  });

  it('handles multiple input types', () => {
    const result = expandTypes(['IfcWall', 'IfcRoof']);
    expect(result).toContain('IFCWALL');
    expect(result).toContain('IFCWALLSTANDARDCASE');
    expect(result).toContain('IFCROOF');
  });

  it('handles empty input', () => {
    expect(expandTypes([])).toEqual([]);
  });

  it('is case-insensitive (converts to uppercase)', () => {
    const result = expandTypes(['ifcwall']);
    expect(result).toContain('IFCWALL');
    expect(result).toContain('IFCWALLSTANDARDCASE');
  });

  it('handles already-uppercase input', () => {
    const result = expandTypes(['IFCWALL']);
    expect(result).toContain('IFCWALL');
    expect(result).toContain('IFCWALLSTANDARDCASE');
  });
});

describe('isProductType', () => {
  it('returns false for relationship types', () => {
    expect(isProductType('IFCRELAGGREGATES')).toBe(false);
    expect(isProductType('IFCRELCONTAINEDINSPATIALSTRUCTURE')).toBe(false);
    expect(isProductType('IFCRELDEFINESBYTYPE')).toBe(false);
  });

  it('returns false for property types', () => {
    expect(isProductType('IFCPROPERTYSINGLEVALUE')).toBe(false);
    expect(isProductType('IFCPROPERTYSET')).toBe(false);
  });

  it('returns false for quantity types', () => {
    expect(isProductType('IFCQUANTITYLENGTH')).toBe(false);
    expect(isProductType('IFCELEMENTQUANTITY')).toBe(false);
  });

  it('returns false for type objects (ending with TYPE)', () => {
    expect(isProductType('IFCWALLTYPE')).toBe(false);
    expect(isProductType('IFCSLABTYPE')).toBe(false);
  });

  it('returns false for unknown types', () => {
    expect(isProductType('NOTAREALIFCTYPE')).toBe(false);
  });
});

describe('normalizeBooleanValue', () => {
  it('normalizes true values to "true"', () => {
    expect(normalizeBooleanValue(true)).toBe('true');
    expect(normalizeBooleanValue('.T.')).toBe('true');
    expect(normalizeBooleanValue('true')).toBe('true');
    expect(normalizeBooleanValue('TRUE')).toBe('true');
  });

  it('normalizes false values to "false"', () => {
    expect(normalizeBooleanValue(false)).toBe('false');
    expect(normalizeBooleanValue('.F.')).toBe('false');
    expect(normalizeBooleanValue('false')).toBe('false');
    expect(normalizeBooleanValue('FALSE')).toBe('false');
  });

  it('passes through non-boolean values unchanged', () => {
    expect(normalizeBooleanValue('hello')).toBe('hello');
    expect(normalizeBooleanValue(42)).toBe(42);
    expect(normalizeBooleanValue(null)).toBe(null);
    expect(normalizeBooleanValue(undefined)).toBe(undefined);
    expect(normalizeBooleanValue(0)).toBe(0);
    expect(normalizeBooleanValue('')).toBe('');
  });
});

describe('normalizePropertyValue', () => {
  it('returns null for null/undefined', () => {
    expect(normalizePropertyValue(null)).toBeNull();
    expect(normalizePropertyValue(undefined)).toBeNull();
  });

  it('passes through strings', () => {
    expect(normalizePropertyValue('hello')).toBe('hello');
    expect(normalizePropertyValue('')).toBe('');
  });

  it('passes through numbers', () => {
    expect(normalizePropertyValue(42)).toBe(42);
    expect(normalizePropertyValue(3.14)).toBe(3.14);
    expect(normalizePropertyValue(0)).toBe(0);
  });

  it('passes through booleans', () => {
    expect(normalizePropertyValue(true)).toBe(true);
    expect(normalizePropertyValue(false)).toBe(false);
  });

  it('JSON-stringifies objects', () => {
    expect(normalizePropertyValue({ key: 'val' })).toBe('{"key":"val"}');
  });

  it('JSON-stringifies arrays', () => {
    expect(normalizePropertyValue([1, 2, 3])).toBe('[1,2,3]');
  });

  it('converts non-serializable values to String()', () => {
    // BigInt can't be JSON.stringified, so falls to String()
    expect(normalizePropertyValue(BigInt(99))).toBe('99');
  });
});
