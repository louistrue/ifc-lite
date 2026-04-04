/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  matchConstraint,
  formatConstraint,
  getConstraintMismatchReason,
} from './index.js';
import type {
  IDSSimpleValue,
  IDSPatternConstraint,
  IDSEnumerationConstraint,
  IDSBoundsConstraint,
  IDSConstraint,
} from '../types.js';

// ============================================================================
// matchConstraint — Simple Values
// ============================================================================

describe('matchConstraint — simpleValue', () => {
  const sv = (value: string): IDSSimpleValue => ({
    type: 'simpleValue',
    value,
  });

  it('matches exact string', () => {
    expect(matchConstraint(sv('hello'), 'hello')).toBe(true);
  });

  it('rejects different string', () => {
    expect(matchConstraint(sv('hello'), 'world')).toBe(false);
  });

  it('matches case-insensitively (IFC entity names)', () => {
    expect(matchConstraint(sv('IFCWALL'), 'IfcWall')).toBe(true);
    expect(matchConstraint(sv('IfcWall'), 'IFCWALL')).toBe(true);
    expect(matchConstraint(sv('ifcwall'), 'IFCWALL')).toBe(true);
  });

  it('matches numeric values with tolerance', () => {
    expect(matchConstraint(sv('3.14'), 3.14)).toBe(true);
    expect(matchConstraint(sv('3.14'), 3.1400005)).toBe(true); // within 1e-6
    expect(matchConstraint(sv('3.14'), 3.15)).toBe(false);
  });

  it('matches numeric string against numeric string', () => {
    expect(matchConstraint(sv('42'), '42')).toBe(true);
    expect(matchConstraint(sv('42'), '42.0000005')).toBe(true); // within tolerance
  });

  it('matches boolean true', () => {
    expect(matchConstraint(sv('true'), true)).toBe(true);
    expect(matchConstraint(sv('1'), true)).toBe(true);
    expect(matchConstraint(sv('false'), true)).toBe(false);
  });

  it('matches boolean false', () => {
    expect(matchConstraint(sv('false'), false)).toBe(true);
    expect(matchConstraint(sv('0'), false)).toBe(true);
    expect(matchConstraint(sv('true'), false)).toBe(false);
  });

  it('matches boolean string values', () => {
    expect(matchConstraint(sv('true'), 'true')).toBe(true);
    expect(matchConstraint(sv('TRUE'), 'true')).toBe(true);
    expect(matchConstraint(sv('false'), 'FALSE')).toBe(true);
    expect(matchConstraint(sv('true'), 'false')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(matchConstraint(sv('anything'), null)).toBe(false);
    expect(matchConstraint(sv('anything'), undefined)).toBe(false);
  });

  it('handles empty string', () => {
    expect(matchConstraint(sv(''), '')).toBe(true);
    expect(matchConstraint(sv(''), 'notempty')).toBe(false);
  });
});

// ============================================================================
// matchConstraint — Pattern
// ============================================================================

describe('matchConstraint — pattern', () => {
  const pat = (pattern: string): IDSPatternConstraint => ({
    type: 'pattern',
    pattern,
  });

  it('matches simple regex', () => {
    expect(matchConstraint(pat('Wall.*'), 'Wall_001')).toBe(true);
    expect(matchConstraint(pat('Wall.*'), 'Slab_001')).toBe(false);
  });

  it('anchors the match to the full string', () => {
    // Pattern should match entire string, not just a substring
    expect(matchConstraint(pat('Wall'), 'Wall')).toBe(true);
    expect(matchConstraint(pat('Wall'), 'BigWall')).toBe(false);
    expect(matchConstraint(pat('Wall'), 'WallBig')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(matchConstraint(pat('IFCWALL'), 'IfcWall')).toBe(true);
    expect(matchConstraint(pat('ifcwall'), 'IFCWALL')).toBe(true);
  });

  it('converts XSD \\i to initial name char class', () => {
    // \i matches [A-Za-z_:]
    expect(matchConstraint(pat('\\i.*'), 'abc')).toBe(true);
    expect(matchConstraint(pat('\\i.*'), '_test')).toBe(true);
  });

  it('converts XSD \\c to name char class', () => {
    // \c matches [A-Za-z0-9._:-]
    expect(matchConstraint(pat('\\c+'), 'a.b-c:1')).toBe(true);
  });

  it('handles \\p{...} unicode categories as dot', () => {
    expect(matchConstraint(pat('\\p{L}+'), 'hello')).toBe(true);
  });

  it('returns false for invalid regex', () => {
    // Unbalanced brackets should not throw, just return false
    expect(matchConstraint(pat('[invalid'), 'test')).toBe(false);
  });

  it('matches number converted to string', () => {
    expect(matchConstraint(pat('[0-9]+\\.?[0-9]*'), 3.14)).toBe(true);
  });
});

// ============================================================================
// matchConstraint — Enumeration
// ============================================================================

describe('matchConstraint — enumeration', () => {
  const enumC = (values: string[]): IDSEnumerationConstraint => ({
    type: 'enumeration',
    values,
  });

  it('matches single value', () => {
    expect(matchConstraint(enumC(['IFCWALL']), 'IFCWALL')).toBe(true);
  });

  it('matches one of multiple values', () => {
    const c = enumC(['IFCWALL', 'IFCSLAB', 'IFCBEAM']);
    expect(matchConstraint(c, 'IFCSLAB')).toBe(true);
    expect(matchConstraint(c, 'IFCCOLUMN')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(matchConstraint(enumC(['IFCWALL']), 'IfcWall')).toBe(true);
    expect(matchConstraint(enumC(['IfcWall']), 'IFCWALL')).toBe(true);
  });

  it('matches numeric values with tolerance', () => {
    expect(matchConstraint(enumC(['3.14', '2.71']), 3.14)).toBe(true);
    expect(matchConstraint(enumC(['3.14', '2.71']), 2.7100005)).toBe(true);
    expect(matchConstraint(enumC(['3.14', '2.71']), 9.99)).toBe(false);
  });

  it('returns false when nothing matches', () => {
    expect(matchConstraint(enumC(['A', 'B', 'C']), 'D')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(matchConstraint(enumC(['A']), null)).toBe(false);
    expect(matchConstraint(enumC(['A']), undefined)).toBe(false);
  });
});

// ============================================================================
// matchConstraint — Bounds
// ============================================================================

describe('matchConstraint — bounds', () => {
  const bounds = (
    opts: Partial<IDSBoundsConstraint>
  ): IDSBoundsConstraint => ({
    type: 'bounds',
    ...opts,
  });

  it('minInclusive — passes at boundary', () => {
    expect(matchConstraint(bounds({ minInclusive: 10 }), 10)).toBe(true);
  });

  it('minInclusive — passes above boundary', () => {
    expect(matchConstraint(bounds({ minInclusive: 10 }), 15)).toBe(true);
  });

  it('minInclusive — fails below boundary', () => {
    expect(matchConstraint(bounds({ minInclusive: 10 }), 9)).toBe(false);
  });

  it('maxInclusive — passes at boundary', () => {
    expect(matchConstraint(bounds({ maxInclusive: 100 }), 100)).toBe(true);
  });

  it('maxInclusive — fails above boundary', () => {
    expect(matchConstraint(bounds({ maxInclusive: 100 }), 101)).toBe(false);
  });

  it('minExclusive — fails at exact boundary', () => {
    expect(matchConstraint(bounds({ minExclusive: 10 }), 10)).toBe(false);
  });

  it('minExclusive — passes above boundary', () => {
    expect(matchConstraint(bounds({ minExclusive: 10 }), 10.001)).toBe(true);
  });

  it('maxExclusive — fails at exact boundary', () => {
    expect(matchConstraint(bounds({ maxExclusive: 100 }), 100)).toBe(false);
  });

  it('maxExclusive — passes below boundary', () => {
    expect(matchConstraint(bounds({ maxExclusive: 100 }), 99.999)).toBe(true);
  });

  it('combined minInclusive + maxInclusive range', () => {
    const c = bounds({ minInclusive: 0, maxInclusive: 100 });
    expect(matchConstraint(c, 0)).toBe(true);
    expect(matchConstraint(c, 50)).toBe(true);
    expect(matchConstraint(c, 100)).toBe(true);
    expect(matchConstraint(c, -1)).toBe(false);
    expect(matchConstraint(c, 101)).toBe(false);
  });

  it('combined minExclusive + maxExclusive range', () => {
    const c = bounds({ minExclusive: 0, maxExclusive: 100 });
    expect(matchConstraint(c, 0)).toBe(false);
    expect(matchConstraint(c, 50)).toBe(true);
    expect(matchConstraint(c, 100)).toBe(false);
  });

  it('returns false for non-numeric actual value', () => {
    expect(matchConstraint(bounds({ minInclusive: 0 }), 'abc')).toBe(false);
  });

  it('parses string numbers', () => {
    expect(matchConstraint(bounds({ minInclusive: 0, maxInclusive: 100 }), '50')).toBe(true);
  });

  it('returns false for null/undefined', () => {
    expect(matchConstraint(bounds({ minInclusive: 0 }), null)).toBe(false);
    expect(matchConstraint(bounds({ minInclusive: 0 }), undefined)).toBe(false);
  });

  it('respects numeric tolerance at boundaries', () => {
    // Value just barely below minInclusive but within tolerance
    expect(matchConstraint(bounds({ minInclusive: 10 }), 10 - 0.5e-6)).toBe(true);
    // Value beyond tolerance below minInclusive
    expect(matchConstraint(bounds({ minInclusive: 10 }), 10 - 2e-6)).toBe(false);
  });

  it('no bounds specified accepts any number', () => {
    expect(matchConstraint(bounds({}), 999)).toBe(true);
    expect(matchConstraint(bounds({}), -999)).toBe(true);
  });
});

// ============================================================================
// matchConstraint — unknown type
// ============================================================================

describe('matchConstraint — unknown type', () => {
  it('returns false for unknown constraint type', () => {
    const unknownConstraint = { type: 'unknownType', value: 'test' } as unknown as IDSConstraint;
    expect(matchConstraint(unknownConstraint, 'test')).toBe(false);
  });
});

// ============================================================================
// formatConstraint
// ============================================================================

describe('formatConstraint', () => {
  it('formats simpleValue', () => {
    expect(formatConstraint({ type: 'simpleValue', value: 'IFCWALL' })).toBe('"IFCWALL"');
  });

  it('formats pattern', () => {
    expect(formatConstraint({ type: 'pattern', pattern: 'Wall.*' })).toBe('pattern "Wall.*"');
  });

  it('formats single-value enumeration as simple string', () => {
    expect(formatConstraint({ type: 'enumeration', values: ['IFCWALL'] })).toBe('"IFCWALL"');
  });

  it('formats multi-value enumeration', () => {
    const result = formatConstraint({
      type: 'enumeration',
      values: ['IFCWALL', 'IFCSLAB'],
    });
    expect(result).toBe('one of ["IFCWALL", "IFCSLAB"]');
  });

  it('formats bounds with minInclusive + maxInclusive as "between"', () => {
    expect(
      formatConstraint({ type: 'bounds', minInclusive: 0, maxInclusive: 100 })
    ).toBe('between 0 and 100');
  });

  it('formats bounds with only minInclusive', () => {
    expect(
      formatConstraint({ type: 'bounds', minInclusive: 5 })
    ).toBe('>= 5');
  });

  it('formats bounds with only maxInclusive', () => {
    expect(
      formatConstraint({ type: 'bounds', maxInclusive: 100 })
    ).toBe('<= 100');
  });

  it('formats bounds with minExclusive', () => {
    expect(
      formatConstraint({ type: 'bounds', minExclusive: 0 })
    ).toBe('> 0');
  });

  it('formats bounds with maxExclusive', () => {
    expect(
      formatConstraint({ type: 'bounds', maxExclusive: 100 })
    ).toBe('< 100');
  });

  it('formats bounds with minExclusive + maxExclusive', () => {
    expect(
      formatConstraint({ type: 'bounds', minExclusive: 0, maxExclusive: 100 })
    ).toBe('> 0 and < 100');
  });

  it('formats empty bounds as "any value"', () => {
    expect(formatConstraint({ type: 'bounds' })).toBe('any value');
  });

  it('formats unknown type as "unknown"', () => {
    const c = { type: 'unknownType' } as unknown as IDSConstraint;
    expect(formatConstraint(c)).toBe('unknown');
  });
});

// ============================================================================
// getConstraintMismatchReason
// ============================================================================

describe('getConstraintMismatchReason', () => {
  it('returns "value is missing" for null', () => {
    expect(
      getConstraintMismatchReason({ type: 'simpleValue', value: 'x' }, null)
    ).toBe('value is missing');
  });

  it('returns "value is missing" for undefined', () => {
    expect(
      getConstraintMismatchReason({ type: 'simpleValue', value: 'x' }, undefined)
    ).toBe('value is missing');
  });

  it('describes simpleValue mismatch', () => {
    const reason = getConstraintMismatchReason(
      { type: 'simpleValue', value: 'expected' },
      'actual'
    );
    expect(reason).toContain('expected');
    expect(reason).toContain('actual');
  });

  it('describes pattern mismatch', () => {
    const reason = getConstraintMismatchReason(
      { type: 'pattern', pattern: 'Wall.*' },
      'Slab_001'
    );
    expect(reason).toContain('Slab_001');
    expect(reason).toContain('Wall.*');
  });

  it('describes enumeration mismatch', () => {
    const reason = getConstraintMismatchReason(
      { type: 'enumeration', values: ['A', 'B'] },
      'C'
    );
    expect(reason).toContain('C');
    expect(reason).toContain('A');
    expect(reason).toContain('B');
  });

  it('describes bounds mismatch for non-numeric', () => {
    const reason = getConstraintMismatchReason(
      { type: 'bounds', minInclusive: 0 },
      'abc'
    );
    expect(reason).toContain('not a valid number');
  });

  it('describes bounds violation with minInclusive', () => {
    const reason = getConstraintMismatchReason(
      { type: 'bounds', minInclusive: 10 },
      5
    );
    expect(reason).toContain('>= 10');
  });

  it('describes bounds violation with maxInclusive', () => {
    const reason = getConstraintMismatchReason(
      { type: 'bounds', maxInclusive: 10 },
      15
    );
    expect(reason).toContain('<= 10');
  });

  it('returns "unknown constraint type" for unrecognized type', () => {
    const c = { type: 'unknownType' } as unknown as IDSConstraint;
    expect(getConstraintMismatchReason(c, 'value')).toBe('unknown constraint type');
  });
});
