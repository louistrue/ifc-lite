/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createSectionSlice, type SectionSlice } from './sectionSlice.js';
import { SECTION_PLANE_DEFAULTS } from '../constants.js';

describe('SectionSlice', () => {
  let state: SectionSlice;
  let setState: (partial: Partial<SectionSlice> | ((state: SectionSlice) => Partial<SectionSlice>)) => void;

  beforeEach(() => {
    // Create a mock set function that updates state
    setState = (partial) => {
      if (typeof partial === 'function') {
        const updates = partial(state);
        state = { ...state, ...updates };
      } else {
        state = { ...state, ...partial };
      }
    };

    // Create slice with mock set function
    state = createSectionSlice(setState, () => state, {} as any);
  });

  describe('initial state', () => {
    it('should have default section plane values', () => {
      assert.strictEqual(state.sectionPlane.axis, SECTION_PLANE_DEFAULTS.AXIS);
      assert.strictEqual(state.sectionPlane.position, SECTION_PLANE_DEFAULTS.POSITION);
      assert.strictEqual(state.sectionPlane.enabled, SECTION_PLANE_DEFAULTS.ENABLED);
      assert.strictEqual(state.sectionPlane.flipped, SECTION_PLANE_DEFAULTS.FLIPPED);
    });
  });

  describe('setSectionPlaneAxis', () => {
    it('should update the axis', () => {
      state.setSectionPlaneAxis('front');
      assert.strictEqual(state.sectionPlane.axis, 'front');
    });

    it('should preserve other section plane properties', () => {
      state.sectionPlane.position = 75;
      state.setSectionPlaneAxis('side');
      assert.strictEqual(state.sectionPlane.axis, 'side');
      assert.strictEqual(state.sectionPlane.position, 75);
    });
  });

  describe('setSectionPlanePosition', () => {
    it('should update the position', () => {
      state.setSectionPlanePosition(75);
      assert.strictEqual(state.sectionPlane.position, 75);
    });

    it('should clamp position to minimum 0', () => {
      state.setSectionPlanePosition(-10);
      assert.strictEqual(state.sectionPlane.position, 0);
    });

    it('should clamp position to maximum 100', () => {
      state.setSectionPlanePosition(150);
      assert.strictEqual(state.sectionPlane.position, 100);
    });

    it('should handle NaN by defaulting to 0', () => {
      state.setSectionPlanePosition(NaN);
      assert.strictEqual(state.sectionPlane.position, 0);
    });

    it('should coerce string numbers', () => {
      state.setSectionPlanePosition('50' as any);
      assert.strictEqual(state.sectionPlane.position, 50);
    });
  });

  describe('toggleSectionPlane', () => {
    it('should toggle enabled from true to false', () => {
      assert.strictEqual(state.sectionPlane.enabled, true);
      state.toggleSectionPlane();
      assert.strictEqual(state.sectionPlane.enabled, false);
    });

    it('should toggle enabled from false to true', () => {
      state.sectionPlane.enabled = false;
      state.toggleSectionPlane();
      assert.strictEqual(state.sectionPlane.enabled, true);
    });
  });

  describe('flipSectionPlane', () => {
    it('should toggle flipped from false to true', () => {
      assert.strictEqual(state.sectionPlane.flipped, false);
      state.flipSectionPlane();
      assert.strictEqual(state.sectionPlane.flipped, true);
    });

    it('should toggle flipped from true to false', () => {
      state.sectionPlane.flipped = true;
      state.flipSectionPlane();
      assert.strictEqual(state.sectionPlane.flipped, false);
    });
  });

  describe('resetSectionPlane', () => {
    it('should reset to default values', () => {
      // Modify state
      state.sectionPlane = {
        axis: 'side',
        position: 25,
        enabled: false,
        flipped: true,
      };

      state.resetSectionPlane();

      assert.strictEqual(state.sectionPlane.axis, SECTION_PLANE_DEFAULTS.AXIS);
      assert.strictEqual(state.sectionPlane.position, SECTION_PLANE_DEFAULTS.POSITION);
      assert.strictEqual(state.sectionPlane.enabled, SECTION_PLANE_DEFAULTS.ENABLED);
      assert.strictEqual(state.sectionPlane.flipped, SECTION_PLANE_DEFAULTS.FLIPPED);
    });
  });
});
