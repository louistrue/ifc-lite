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
    setState = (partial) => {
      if (typeof partial === 'function') {
        const updates = partial(state);
        state = { ...state, ...updates };
      } else {
        state = { ...state, ...partial };
      }
    };

    state = createSectionSlice(setState, () => state, {} as any);
  });

  describe('initial state', () => {
    it('should have default section plane values', () => {
      assert.strictEqual(state.sectionPlane.mode, SECTION_PLANE_DEFAULTS.MODE);
      assert.strictEqual(state.sectionPlane.axis, SECTION_PLANE_DEFAULTS.AXIS);
      assert.strictEqual(state.sectionPlane.position, SECTION_PLANE_DEFAULTS.POSITION);
      assert.strictEqual(state.sectionPlane.enabled, SECTION_PLANE_DEFAULTS.ENABLED);
      assert.strictEqual(state.sectionPlane.flipped, SECTION_PLANE_DEFAULTS.FLIPPED);
      assert.strictEqual(state.sectionPlane.face, null);
      assert.strictEqual(state.sectionPlane.gizmo.dragging, false);
    });
  });

  describe('setSectionPlaneAxis', () => {
    it('should update the axis and set mode to axis', () => {
      state.setSectionPlaneAxis('front');
      assert.strictEqual(state.sectionPlane.axis, 'front');
      assert.strictEqual(state.sectionPlane.mode, 'axis');
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
      state.sectionPlane = {
        mode: 'face',
        axis: 'side',
        position: 25,
        enabled: false,
        flipped: true,
        face: { normal: { x: 0, y: 1, z: 0 }, point: { x: 0, y: 0, z: 0 }, offset: 5 },
        gizmo: { dragging: true, startScreenY: 100, startPosition: 25 },
      };

      state.resetSectionPlane();

      assert.strictEqual(state.sectionPlane.mode, SECTION_PLANE_DEFAULTS.MODE);
      assert.strictEqual(state.sectionPlane.axis, SECTION_PLANE_DEFAULTS.AXIS);
      assert.strictEqual(state.sectionPlane.position, SECTION_PLANE_DEFAULTS.POSITION);
      assert.strictEqual(state.sectionPlane.enabled, SECTION_PLANE_DEFAULTS.ENABLED);
      assert.strictEqual(state.sectionPlane.flipped, SECTION_PLANE_DEFAULTS.FLIPPED);
      assert.strictEqual(state.sectionPlane.face, null);
      assert.strictEqual(state.sectionPlane.gizmo.dragging, false);
    });
  });

  describe('setSectionMode', () => {
    it('should switch to face mode', () => {
      state.setSectionMode('face');
      assert.strictEqual(state.sectionPlane.mode, 'face');
    });

    it('should switch back to axis mode', () => {
      state.setSectionMode('face');
      state.setSectionMode('axis');
      assert.strictEqual(state.sectionPlane.mode, 'axis');
    });
  });

  describe('setSectionFace', () => {
    it('should set face data and switch to face mode', () => {
      const face = {
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 5, y: 3, z: 2 },
        offset: 0,
      };
      state.setSectionFace(face);
      assert.strictEqual(state.sectionPlane.mode, 'face');
      assert.strictEqual(state.sectionPlane.enabled, true);
      assert.deepStrictEqual(state.sectionPlane.face, face);
    });
  });

  describe('setSectionFaceOffset', () => {
    it('should update the face offset', () => {
      state.setSectionFace({
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 0, y: 0, z: 0 },
        offset: 0,
      });
      state.setSectionFaceOffset(3.5);
      assert.strictEqual(state.sectionPlane.face!.offset, 3.5);
    });

    it('should not change state when no face is set', () => {
      const before = { ...state.sectionPlane };
      state.setSectionFaceOffset(5);
      assert.strictEqual(state.sectionPlane.face, before.face);
    });
  });

  describe('clearSectionFace', () => {
    it('should clear the face and switch to axis mode', () => {
      state.setSectionFace({
        normal: { x: 1, y: 0, z: 0 },
        point: { x: 0, y: 0, z: 0 },
        offset: 2,
      });
      state.clearSectionFace();
      assert.strictEqual(state.sectionPlane.mode, 'axis');
      assert.strictEqual(state.sectionPlane.face, null);
    });
  });

  describe('gizmo interaction', () => {
    it('should start gizmo drag', () => {
      state.startGizmoDrag(400);
      assert.strictEqual(state.sectionPlane.gizmo.dragging, true);
      assert.strictEqual(state.sectionPlane.gizmo.startScreenY, 400);
      assert.strictEqual(state.sectionPlane.gizmo.startPosition, 50); // default position
    });

    it('should update position during drag', () => {
      state.startGizmoDrag(400);
      // Drag up by 100px with sensitivity 0.15 => delta = (400 - 300) * 0.15 = 15
      state.updateGizmoDrag(300, 0.15);
      assert.strictEqual(state.sectionPlane.position, 65); // 50 + 15
    });

    it('should clamp position during drag', () => {
      state.setSectionPlanePosition(95);
      state.startGizmoDrag(400);
      // Drag up by 200px with sensitivity 0.15 => delta = 30, 95 + 30 = 125, clamped to 100
      state.updateGizmoDrag(200, 0.15);
      assert.strictEqual(state.sectionPlane.position, 100);
    });

    it('should end gizmo drag', () => {
      state.startGizmoDrag(400);
      state.updateGizmoDrag(300, 0.15);
      state.endGizmoDrag();
      assert.strictEqual(state.sectionPlane.gizmo.dragging, false);
    });

    it('should update face offset during drag in face mode', () => {
      state.setSectionFace({
        normal: { x: 0, y: 1, z: 0 },
        point: { x: 0, y: 5, z: 0 },
        offset: 0,
      });
      state.startGizmoDrag(400);
      // Drag up by 100px with sensitivity 0.02 => delta = (400 - 300) * 0.02 = 2
      state.updateGizmoDrag(300, 0.02);
      assert.strictEqual(state.sectionPlane.face!.offset, 2); // 0 + 2
    });

    it('should not update when not dragging', () => {
      const posBefore = state.sectionPlane.position;
      state.updateGizmoDrag(300, 0.15);
      assert.strictEqual(state.sectionPlane.position, posBefore);
    });
  });
});
