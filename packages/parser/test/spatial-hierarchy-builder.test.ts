/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  EntityTableBuilder,
  IfcTypeEnum,
  RelationshipGraphBuilder,
  RelationshipType,
  StringTable,
} from '@ifc-lite/data';
import { SpatialHierarchyBuilder } from '../src/spatial-hierarchy-builder.js';

describe('SpatialHierarchyBuilder', () => {
  it('builds IFC4.3 facility hierarchies and expands elements through facility parts', () => {
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

    const hierarchy = new SpatialHierarchyBuilder().build(
      entities.build(),
      relationships.build(),
      strings,
      new Uint8Array(),
      { byId: { get: () => undefined } },
    );

    expect(hierarchy.project.children).toHaveLength(1);
    expect(hierarchy.project.children[0].type).toBe(IfcTypeEnum.IfcBridge);
    expect(hierarchy.project.children[0].children[0].type).toBe(IfcTypeEnum.IfcBridgePart);
    expect(hierarchy.project.children[0].children[0].elements).toEqual([4]);
    expect(hierarchy.elementToStorey.get(4)).toBeUndefined();
    expect(hierarchy.getPath(4).map((node) => node.expressId)).toEqual([1, 2, 3]);
    expect(hierarchy.byBuilding.get(2)).toEqual([]);
  });
});
