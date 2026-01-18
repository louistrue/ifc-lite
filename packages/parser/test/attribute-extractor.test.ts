/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tests for on-demand attribute extraction
 */

import { describe, it, expect } from 'vitest';
import { extractEntityAttributesOnDemand } from '../src/columnar-parser';
import type { IfcDataStore } from '../src/columnar-parser';
import type { EntityRef } from '../src/types';

describe('Entity Attribute Extraction', () => {
  it('should extract GlobalId, Name, Description, and ObjectType from IFC entity', () => {
    // Create a minimal IFC entity in STEP format
    // IfcWall: #123 = IFCWALL('0hqLFcvYZB4I_n8fG2dLb3', #1, 'My Wall Name', 'Wall Description', 'Wall Type', ...)
    const ifcEntity = `#123=IFCWALL('0hqLFcvYZB4I_n8fG2dLb3',#1,'My Wall Name','Wall Description','Wall Type',#2,#3,.NOTDEFINED.);`;
    const source = new TextEncoder().encode(ifcEntity);

    // Create minimal store with necessary structures
    const entityRef: EntityRef = {
      expressId: 123,
      type: 'IfcWall',
      byteOffset: 0,
      byteLength: source.length,
      lineNumber: 1,
    };

    const store = {
      source,
      entityIndex: {
        byId: new Map([[123, entityRef]]),
        byType: new Map([['IFCWALL', [123]]]),
      },
    } as unknown as IfcDataStore;

    const attrs = extractEntityAttributesOnDemand(store, 123);

    expect(attrs.globalId).toBe('0hqLFcvYZB4I_n8fG2dLb3');
    expect(attrs.name).toBe('My Wall Name');
    expect(attrs.description).toBe('Wall Description');
    expect(attrs.objectType).toBe('Wall Type');
  });

  it('should return empty strings for missing attributes', () => {
    // IFC entity with $  for missing values
    const ifcEntity = `#456=IFCBEAM('abc123',$,$,$,$,$,$,.NOTDEFINED.);`;
    const source = new TextEncoder().encode(ifcEntity);

    const entityRef: EntityRef = {
      expressId: 456,
      type: 'IfcBeam',
      byteOffset: 0,
      byteLength: source.length,
      lineNumber: 1,
    };

    const store = {
      source,
      entityIndex: {
        byId: new Map([[456, entityRef]]),
        byType: new Map([['IFCBEAM', [456]]]),
      },
    } as unknown as IfcDataStore;

    const attrs = extractEntityAttributesOnDemand(store, 456);

    expect(attrs.globalId).toBe('abc123');
    expect(attrs.name).toBe('');
    expect(attrs.description).toBe('');
    expect(attrs.objectType).toBe('');
  });

  it('should handle entity not found', () => {
    const store = {
      source: new Uint8Array(0),
      entityIndex: {
        byId: new Map(),
        byType: new Map(),
      },
    } as unknown as IfcDataStore;

    const attrs = extractEntityAttributesOnDemand(store, 999);

    expect(attrs.globalId).toBe('');
    expect(attrs.name).toBe('');
    expect(attrs.description).toBe('');
    expect(attrs.objectType).toBe('');
  });
});
