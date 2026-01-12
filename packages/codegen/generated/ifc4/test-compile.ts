/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Test file to verify generated types compile correctly
import type { IfcWall, IfcDoor, IfcWindow, IfcProject, IfcBuilding } from './entities';
import { IfcWallTypeEnum, IfcDoorTypeEnum } from './enums';
import { SCHEMA_REGISTRY, getEntityMetadata } from './schema-registry';

// Test: Create typed objects
const wall: IfcWall = {
  GlobalId: 'abc123',
  Name: 'Test Wall',
  ObjectType: 'External Wall',
  PredefinedType: IfcWallTypeEnum.SOLIDWALL,
};

const door: IfcDoor = {
  GlobalId: 'door123',
  Name: 'Main Door',
  ObjectType: 'Entrance',
  PredefinedType: IfcDoorTypeEnum.DOOR,
  OverallHeight: 2.1,
  OverallWidth: 0.9,
};

// Test: Use schema registry
const wallMetadata = getEntityMetadata('IfcWall');
console.log(wallMetadata?.name);
console.log(wallMetadata?.parent);
console.log(wallMetadata?.attributes);

// Test: Check entity count
const entityCount = Object.keys(SCHEMA_REGISTRY.entities).length;
console.log(`Total entities: ${entityCount}`);

export { wall, door, wallMetadata, entityCount };
