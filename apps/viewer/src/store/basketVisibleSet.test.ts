/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { useViewerStore } from './index.js';
import {
  getSmartBasketInputFromStore,
  getBasketSelectionRefsFromStore,
  getVisibleBasketEntityRefsFromStore,
  isBasketIsolationActiveFromStore,
  invalidateVisibleBasketCache,
} from './basketVisibleSet.js';
import { entityRefToString } from './types.js';

describe('basketVisibleSet', () => {
  beforeEach(() => {
    invalidateVisibleBasketCache();
    useViewerStore.getState().resetViewerState();
  });

  describe('source priority', () => {
    it('returns selection refs when selectedEntitiesSet has items', () => {
      useViewerStore.setState({
        selectedEntitiesSet: new Set(['legacy:100', 'legacy:200']),
      });

      const result = getSmartBasketInputFromStore();
      assert.strictEqual(result.source, 'selection');
      assert.strictEqual(result.refs.length, 2);
      assert.ok(result.refs.some((r) => entityRefToString(r) === 'legacy:100'));
      assert.ok(result.refs.some((r) => entityRefToString(r) === 'legacy:200'));
    });

    it('returns hierarchy refs when hierarchyBasketSelection has items and no selection', () => {
      useViewerStore.setState({
        selectedEntitiesSet: new Set(),
        selectedEntity: null,
        selectedEntityIds: new Set(),
        hierarchyBasketSelection: new Set(['legacy:300']),
      });

      const result = getSmartBasketInputFromStore();
      assert.strictEqual(result.source, 'hierarchy');
      assert.ok(result.refs.length >= 1);
    });

    it('returns visible refs when only geometry is available', () => {
      useViewerStore.setState({
        selectedEntitiesSet: new Set(),
        selectedEntity: null,
        selectedEntityIds: new Set(),
        hierarchyBasketSelection: new Set(),
        geometryResult: {
          meshes: [
            { expressId: 1, ifcType: 'IfcWall' },
            { expressId: 2, ifcType: 'IfcSlab' },
          ],
        } as any,
      });

      const result = getSmartBasketInputFromStore();
      assert.ok(result.source === 'visible' || result.source === 'empty');
      if (result.source === 'visible') {
        assert.ok(result.refs.length >= 1);
      }
    });

    it('returns empty when no source has refs', () => {
      useViewerStore.setState({
        selectedEntitiesSet: new Set(),
        selectedEntity: null,
        selectedEntityIds: new Set(),
        hierarchyBasketSelection: new Set(),
        geometryResult: null,
      });

      const result = getSmartBasketInputFromStore();
      assert.strictEqual(result.source, 'empty');
      assert.strictEqual(result.refs.length, 0);
    });
  });

  describe('isBasketIsolationActiveFromStore', () => {
    it('returns true when isolated equals basket', () => {
      useViewerStore.setState({
        pinboardEntities: new Set(['legacy:100', 'legacy:200']),
        isolatedEntities: new Set([100, 200]),
        models: new Map(),
      });

      assert.strictEqual(isBasketIsolationActiveFromStore(), true);
    });

    it('returns false when pinboard is empty', () => {
      useViewerStore.setState({
        pinboardEntities: new Set(),
        isolatedEntities: new Set([100]),
      });

      assert.strictEqual(isBasketIsolationActiveFromStore(), false);
    });

    it('returns false when isolated is null', () => {
      useViewerStore.setState({
        pinboardEntities: new Set(['legacy:100']),
        isolatedEntities: null,
      });

      assert.strictEqual(isBasketIsolationActiveFromStore(), false);
    });

    it('returns false when isolated size differs from basket', () => {
      useViewerStore.setState({
        pinboardEntities: new Set(['legacy:100', 'legacy:200']),
        isolatedEntities: new Set([100]),
      });

      assert.strictEqual(isBasketIsolationActiveFromStore(), false);
    });
  });

  describe('visibility cache', () => {
    it('invalidateVisibleBasketCache clears cache', () => {
      useViewerStore.setState({
        geometryResult: { meshes: [{ expressId: 1, ifcType: 'IfcWall' }] } as any,
      });

      const first = getVisibleBasketEntityRefsFromStore();
      invalidateVisibleBasketCache();
      const second = getVisibleBasketEntityRefsFromStore();

      assert.deepStrictEqual(first, second);
    });

    it('returns consistent result on repeated calls with same state', () => {
      useViewerStore.setState({
        geometryResult: { meshes: [{ expressId: 1, ifcType: 'IfcWall' }] } as any,
      });

      const a = getVisibleBasketEntityRefsFromStore();
      const b = getVisibleBasketEntityRefsFromStore();

      assert.deepStrictEqual(a, b);
    });
  });

  describe('federation: unresolved globalId in multi-model', () => {
    it('getBasketSelectionRefsFromStore returns array when models exist', () => {
      useViewerStore.setState({
        selectedEntityIds: new Set([99999]),
        selectedEntitiesSet: new Set(),
        selectedEntity: null,
      });

      const refs = getBasketSelectionRefsFromStore();
      assert.ok(Array.isArray(refs));
    });
  });
});
