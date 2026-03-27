/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EntityTableBuilder,
  IfcTypeEnum,
  RelationshipGraphBuilder,
  RelationshipType,
  StringTable,
} from '@ifc-lite/data';
import { rebuildSpatialHierarchy } from './spatialHierarchy';

describe('rebuildSpatialHierarchy', () => {
  it('preserves IFC4.3 facility-part trees during cache rebuilds', () => {
    const strings = new StringTable();
    const entities = new EntityTableBuilder(4, strings);
    entities.add(1, 'IFCPROJECT', '0', 'Infra Project', '', '');
    entities.add(2, 'IFCBRIDGE', '1', 'Bridge A', '', '');
    entities.add(3, 'IFCBRIDGEPART', '2', 'Deck', '', '');
    entities.add(4, 'IFCWALL', '3', 'Barrier', '', '', true);

    const relationships = new RelationshipGraphBuilder();
    relationships.addEdge(1, 2, RelationshipType.Aggregates, 10);
    relationships.addEdge(2, 3, RelationshipType.Aggregates, 11);
    relationships.addEdge(3, 4, RelationshipType.ContainsElements, 12);

    const hierarchy = rebuildSpatialHierarchy(entities.build(), relationships.build());
    assert.ok(hierarchy);
    assert.equal(hierarchy.project.children[0].type, IfcTypeEnum.IfcBridge);
    assert.equal(hierarchy.project.children[0].children[0].type, IfcTypeEnum.IfcBridgePart);
    assert.deepEqual(hierarchy.project.children[0].children[0].elements, [4]);
    assert.equal(hierarchy.elementToStorey.get(4), undefined);
    assert.deepEqual(hierarchy.getPath(4).map((node) => node.expressId), [1, 2, 3]);
  });
});
