/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  generateIfcGuid,
  generateUuid,
  ifcGuidToUuid,
  isValidIfcGuid,
  isValidUuid,
  uuidToIfcGuid,
} from './guid.js';

describe('guid', () => {
  it('round-trips UUIDs through IFC GUID encoding', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const ifcGuid = uuidToIfcGuid(uuid);

    expect(ifcGuidToUuid(ifcGuid)).toBe(uuid);
    expect(isValidIfcGuid(ifcGuid)).toBe(true);
  });

  it('generates schema-valid IFC GUIDs', () => {
    for (let i = 0; i < 100; i++) {
      const ifcGuid = generateIfcGuid();
      expect(isValidIfcGuid(ifcGuid)).toBe(true);
      expect(ifcGuid).toHaveLength(22);
      expect(['0', '1', '2', '3']).toContain(ifcGuid[0]);
    }
  });

  it('generates RFC-style UUID strings', () => {
    const uuid = generateUuid();
    expect(isValidUuid(uuid)).toBe(true);
  });
});
