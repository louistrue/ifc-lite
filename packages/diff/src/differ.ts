/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core IFC diff engine — compares two IfcDataStores by GlobalId matching
 * and hashing of attributes, properties, and quantities.
 */

import type { IfcDataStore } from '@ifc-lite/parser';
import { extractAllEntityAttributes } from '@ifc-lite/parser';
import { EntityNode } from '@ifc-lite/query';
import { IFC_ENTITY_NAMES } from '@ifc-lite/data';
import type {
  DiffSettings,
  DiffResult,
  EntityChange,
  AttributeChange,
  PropertyChange,
  QuantityChange,
} from './types.js';
import { DEFAULT_DIFF_SETTINGS } from './types.js';

interface EntityInfo {
  expressId: number;
  globalId: string;
  type: string;
  name: string;
}

/**
 * Compute the diff between two IFC data stores.
 *
 * Matches elements by GlobalId, then compares attributes, properties,
 * and quantities to determine what changed.
 */
export function computeDiff(
  oldStore: IfcDataStore,
  newStore: IfcDataStore,
  settings?: DiffSettings,
): DiffResult {
  const opts: Required<DiffSettings> = { ...DEFAULT_DIFF_SETTINGS, ...settings };

  // Build GlobalId → entity maps for both stores
  const oldEntities = buildGlobalIdMap(oldStore);
  const newEntities = buildGlobalIdMap(newStore);

  const added: DiffResult['added'] = [];
  const deleted: DiffResult['deleted'] = [];
  const changed: EntityChange[] = [];
  let unchanged = 0;

  // Find added elements (in new but not in old)
  for (const [gid, info] of newEntities) {
    if (!oldEntities.has(gid)) {
      added.push({ globalId: gid, expressId: info.expressId, type: info.type, name: info.name });
    }
  }

  // Find deleted elements (in old but not in new)
  for (const [gid, info] of oldEntities) {
    if (!newEntities.has(gid)) {
      deleted.push({ globalId: gid, expressId: info.expressId, type: info.type, name: info.name });
    }
  }

  // Compare common elements for changes
  for (const [gid, oldInfo] of oldEntities) {
    const newInfo = newEntities.get(gid);
    if (!newInfo) continue;

    const entityChange = compareEntities(oldStore, newStore, oldInfo, newInfo, opts);
    if (entityChange) {
      changed.push(entityChange);
    } else {
      unchanged++;
    }
  }

  return {
    added,
    deleted,
    changed,
    summary: {
      totalAdded: added.length,
      totalDeleted: deleted.length,
      totalChanged: changed.length,
      totalUnchanged: unchanged,
    },
  };
}

function buildGlobalIdMap(store: IfcDataStore): Map<string, EntityInfo> {
  const map = new Map<string, EntityInfo>();

  for (const [typeName, ids] of store.entityIndex.byType) {
    const displayName = IFC_ENTITY_NAMES[typeName] ?? typeName;
    for (const id of ids) {
      const node = new EntityNode(store, id);
      const gid = node.globalId;
      if (gid) {
        map.set(gid, {
          expressId: id,
          globalId: gid,
          type: displayName,
          name: node.name || '',
        });
      }
    }
  }

  return map;
}

function compareEntities(
  oldStore: IfcDataStore,
  newStore: IfcDataStore,
  oldInfo: EntityInfo,
  newInfo: EntityInfo,
  opts: Required<DiffSettings>,
): EntityChange | null {
  const attributeChanges: AttributeChange[] = [];
  const propertyChanges: PropertyChange[] = [];
  const quantityChanges: QuantityChange[] = [];

  // Compare attributes
  if (opts.attributes) {
    const oldAttrs = extractAllEntityAttributes(oldStore, oldInfo.expressId);
    const newAttrs = extractAllEntityAttributes(newStore, newInfo.expressId);

    const oldAttrMap = new Map(oldAttrs.map(a => [a.name, a.value]));
    const newAttrMap = new Map(newAttrs.map(a => [a.name, a.value]));

    const allAttrKeys = new Set([...oldAttrMap.keys(), ...newAttrMap.keys()]);
    for (const key of allAttrKeys) {
      const oldVal = oldAttrMap.get(key) ?? '';
      const newVal = newAttrMap.get(key) ?? '';
      if (oldVal !== newVal) {
        attributeChanges.push({ attribute: key, oldValue: oldVal, newValue: newVal });
      }
    }
  }

  // Compare properties
  if (opts.properties) {
    const oldNode = new EntityNode(oldStore, oldInfo.expressId);
    const newNode = new EntityNode(newStore, newInfo.expressId);

    const oldProps = oldNode.properties();
    const newProps = newNode.properties();

    const oldPropMap = new Map<string, Map<string, unknown>>();
    for (const pset of oldProps) {
      const props = new Map<string, unknown>();
      for (const p of pset.properties) {
        props.set(p.name, p.value);
      }
      oldPropMap.set(pset.name, props);
    }

    const newPropMap = new Map<string, Map<string, unknown>>();
    for (const pset of newProps) {
      const props = new Map<string, unknown>();
      for (const p of pset.properties) {
        props.set(p.name, p.value);
      }
      newPropMap.set(pset.name, props);
    }

    const allPsetNames = new Set([...oldPropMap.keys(), ...newPropMap.keys()]);
    for (const psetName of allPsetNames) {
      const oldPset = oldPropMap.get(psetName) ?? new Map();
      const newPset = newPropMap.get(psetName) ?? new Map();

      const allPropNames = new Set([...oldPset.keys(), ...newPset.keys()]);
      for (const propName of allPropNames) {
        const oldVal = oldPset.get(propName);
        const newVal = newPset.get(propName);
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          propertyChanges.push({
            psetName,
            propName,
            oldValue: oldVal ?? null,
            newValue: newVal ?? null,
          });
        }
      }
    }
  }

  // Compare quantities
  if (opts.quantities) {
    const oldNode = new EntityNode(oldStore, oldInfo.expressId);
    const newNode = new EntityNode(newStore, newInfo.expressId);

    const oldQsets = oldNode.quantities();
    const newQsets = newNode.quantities();

    const oldQMap = new Map<string, Map<string, number>>();
    for (const qset of oldQsets) {
      const qs = new Map<string, number>();
      for (const q of qset.quantities) {
        qs.set(q.name, q.value);
      }
      oldQMap.set(qset.name, qs);
    }

    const newQMap = new Map<string, Map<string, number>>();
    for (const qset of newQsets) {
      const qs = new Map<string, number>();
      for (const q of qset.quantities) {
        qs.set(q.name, q.value);
      }
      newQMap.set(qset.name, qs);
    }

    const allQsetNames = new Set([...oldQMap.keys(), ...newQMap.keys()]);
    for (const qsetName of allQsetNames) {
      const oldQset = oldQMap.get(qsetName) ?? new Map();
      const newQset = newQMap.get(qsetName) ?? new Map();

      const allQNames = new Set([...oldQset.keys(), ...newQset.keys()]);
      for (const qName of allQNames) {
        const oldVal = oldQset.get(qName) ?? 0;
        const newVal = newQset.get(qName) ?? 0;
        if (oldVal !== newVal) {
          quantityChanges.push({ qsetName, quantityName: qName, oldValue: oldVal, newValue: newVal });
        }
      }
    }
  }

  const hasChanges =
    attributeChanges.length > 0 ||
    propertyChanges.length > 0 ||
    quantityChanges.length > 0;

  if (!hasChanges) return null;

  return {
    globalId: oldInfo.globalId,
    expressId1: oldInfo.expressId,
    expressId2: newInfo.expressId,
    type: newInfo.type,
    name: newInfo.name || oldInfo.name,
    attributeChanges,
    propertyChanges,
    quantityChanges,
  };
}
