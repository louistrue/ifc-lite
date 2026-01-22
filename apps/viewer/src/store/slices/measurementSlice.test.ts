/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMeasurementSlice, type MeasurementSlice } from './measurementSlice.js';

describe('MeasurementSlice', () => {
  let state: MeasurementSlice;
  let setState: (partial: Partial<MeasurementSlice> | ((state: MeasurementSlice) => Partial<MeasurementSlice>)) => void;
  let getState: () => MeasurementSlice;

  beforeEach(() => {
    // Create mock set/get functions
    setState = (partial) => {
      if (typeof partial === 'function') {
        const updates = partial(state);
        state = { ...state, ...updates };
      } else {
        state = { ...state, ...partial };
      }
    };
    getState = () => state;

    // Create slice with mock functions
    state = createMeasurementSlice(setState, getState, {} as any);
  });

  describe('initial state', () => {
    it('should have empty measurements array', () => {
      assert.deepStrictEqual(state.measurements, []);
    });

    it('should have null pending measure point', () => {
      assert.strictEqual(state.pendingMeasurePoint, null);
    });

    it('should have null active measurement', () => {
      assert.strictEqual(state.activeMeasurement, null);
    });

    it('should have snap enabled by default', () => {
      assert.strictEqual(state.snapEnabled, true);
    });
  });

  describe('addMeasurePoint', () => {
    it('should set pending measure point', () => {
      const point = { x: 1, y: 2, z: 3 };
      state.addMeasurePoint(point);
      assert.deepStrictEqual(state.pendingMeasurePoint, point);
    });
  });

  describe('completeMeasurement', () => {
    it('should create measurement when pending point exists', () => {
      const startPoint = { x: 0, y: 0, z: 0 };
      const endPoint = { x: 3, y: 4, z: 0 };

      state.addMeasurePoint(startPoint);
      state.completeMeasurement(endPoint);

      assert.strictEqual(state.measurements.length, 1);
      assert.deepStrictEqual(state.measurements[0].start, startPoint);
      assert.deepStrictEqual(state.measurements[0].end, endPoint);
      assert.strictEqual(state.measurements[0].distance, 5); // 3-4-5 triangle
      assert.strictEqual(state.pendingMeasurePoint, null);
    });

    it('should not create measurement when no pending point', () => {
      const endPoint = { x: 1, y: 1, z: 1 };
      state.completeMeasurement(endPoint);
      assert.strictEqual(state.measurements.length, 0);
    });

    it('should generate unique IDs for rapid measurements', () => {
      const point1 = { x: 0, y: 0, z: 0 };
      const point2 = { x: 1, y: 0, z: 0 };

      state.addMeasurePoint(point1);
      state.completeMeasurement(point2);

      state.addMeasurePoint(point1);
      state.completeMeasurement(point2);

      assert.strictEqual(state.measurements.length, 2);
      assert.notStrictEqual(state.measurements[0].id, state.measurements[1].id);
    });
  });

  describe('startMeasurement', () => {
    it('should initialize active measurement', () => {
      const point = { x: 1, y: 2, z: 3 };
      state.startMeasurement(point);

      assert.deepStrictEqual(state.activeMeasurement?.start, point);
      assert.deepStrictEqual(state.activeMeasurement?.current, point);
      assert.strictEqual(state.activeMeasurement?.distance, 0);
    });
  });

  describe('updateMeasurement', () => {
    it('should update current point and distance', () => {
      const startPoint = { x: 0, y: 0, z: 0 };
      const currentPoint = { x: 3, y: 4, z: 0 };

      state.startMeasurement(startPoint);
      state.updateMeasurement(currentPoint);

      assert.deepStrictEqual(state.activeMeasurement?.start, startPoint);
      assert.deepStrictEqual(state.activeMeasurement?.current, currentPoint);
      assert.strictEqual(state.activeMeasurement?.distance, 5);
    });

    it('should not update when no active measurement', () => {
      const point = { x: 1, y: 1, z: 1 };
      state.updateMeasurement(point);
      assert.strictEqual(state.activeMeasurement, null);
    });
  });

  describe('finalizeMeasurement', () => {
    it('should add completed measurement to list', () => {
      const startPoint = { x: 0, y: 0, z: 0 };
      const endPoint = { x: 1, y: 0, z: 0 };

      state.startMeasurement(startPoint);
      state.updateMeasurement(endPoint);
      state.finalizeMeasurement();

      assert.strictEqual(state.measurements.length, 1);
      assert.deepStrictEqual(state.measurements[0].start, startPoint);
      assert.deepStrictEqual(state.measurements[0].end, endPoint);
      assert.strictEqual(state.activeMeasurement, null);
    });

    it('should not add measurement when no active measurement', () => {
      state.finalizeMeasurement();
      assert.strictEqual(state.measurements.length, 0);
    });
  });

  describe('cancelMeasurement', () => {
    it('should clear active measurement', () => {
      state.startMeasurement({ x: 0, y: 0, z: 0 });
      state.cancelMeasurement();
      assert.strictEqual(state.activeMeasurement, null);
    });

    it('should clear snap target', () => {
      state.snapTarget = { type: 'vertex', position: [0, 0, 0] } as any;
      state.cancelMeasurement();
      assert.strictEqual(state.snapTarget, null);
    });
  });

  describe('deleteMeasurement', () => {
    it('should remove measurement by id', () => {
      state.startMeasurement({ x: 0, y: 0, z: 0 });
      state.updateMeasurement({ x: 1, y: 0, z: 0 });
      state.finalizeMeasurement();

      const id = state.measurements[0].id;
      state.deleteMeasurement(id);

      assert.strictEqual(state.measurements.length, 0);
    });

    it('should not affect other measurements', () => {
      // Create two measurements
      state.startMeasurement({ x: 0, y: 0, z: 0 });
      state.updateMeasurement({ x: 1, y: 0, z: 0 });
      state.finalizeMeasurement();

      state.startMeasurement({ x: 0, y: 0, z: 0 });
      state.updateMeasurement({ x: 2, y: 0, z: 0 });
      state.finalizeMeasurement();

      const firstId = state.measurements[0].id;
      state.deleteMeasurement(firstId);

      assert.strictEqual(state.measurements.length, 1);
      assert.strictEqual(state.measurements[0].distance, 2);
    });
  });

  describe('clearMeasurements', () => {
    it('should clear all measurements and state', () => {
      state.startMeasurement({ x: 0, y: 0, z: 0 });
      state.updateMeasurement({ x: 1, y: 0, z: 0 });
      state.finalizeMeasurement();

      state.addMeasurePoint({ x: 5, y: 5, z: 5 });

      state.clearMeasurements();

      assert.deepStrictEqual(state.measurements, []);
      assert.strictEqual(state.pendingMeasurePoint, null);
      assert.strictEqual(state.activeMeasurement, null);
    });
  });

  describe('toggleSnap', () => {
    it('should toggle snap from enabled to disabled', () => {
      assert.strictEqual(state.snapEnabled, true);
      state.toggleSnap();
      assert.strictEqual(state.snapEnabled, false);
    });

    it('should toggle snap from disabled to enabled', () => {
      state.snapEnabled = false;
      state.toggleSnap();
      assert.strictEqual(state.snapEnabled, true);
    });
  });
});
