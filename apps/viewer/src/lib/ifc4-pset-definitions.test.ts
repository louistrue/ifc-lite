/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getPsetDefinitionsForType,
  getPsetDefinition,
  getAllPsetDefinitions,
  isStandardPset,
  getPropertiesForPset,
  CLASSIFICATION_SYSTEMS,
} from './ifc4-pset-definitions.js';

describe('IFC4 PSet Definitions', () => {
  describe('getPsetDefinitionsForType', () => {
    it('should return wall psets for IfcWall', () => {
      const psets = getPsetDefinitionsForType('IfcWall');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_WallCommon'), 'Should include Pset_WallCommon');
      assert.ok(names.includes('Pset_ManufacturerTypeInformation'), 'Should include generic Pset_ManufacturerTypeInformation');
      assert.ok(names.includes('Pset_Condition'), 'Should include generic Pset_Condition');
      assert.ok(!names.includes('Pset_DoorCommon'), 'Should NOT include Pset_DoorCommon');
      assert.ok(!names.includes('Pset_SlabCommon'), 'Should NOT include Pset_SlabCommon');
    });

    it('should return door psets for IfcDoor', () => {
      const psets = getPsetDefinitionsForType('IfcDoor');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_DoorCommon'), 'Should include Pset_DoorCommon');
      assert.ok(names.includes('Pset_DoorWindowGlazingType'), 'Doors share glazing pset');
      assert.ok(!names.includes('Pset_WallCommon'), 'Should NOT include wall psets');
    });

    it('should return window psets for IfcWindow', () => {
      const psets = getPsetDefinitionsForType('IfcWindow');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_WindowCommon'));
      assert.ok(names.includes('Pset_DoorWindowGlazingType'), 'Windows share glazing pset');
    });

    it('should return space psets for IfcSpace', () => {
      const psets = getPsetDefinitionsForType('IfcSpace');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_SpaceCommon'));
      assert.ok(names.includes('Pset_SpaceFireSafetyRequirements'));
      assert.ok(names.includes('Pset_SpaceOccupancyRequirements'));
    });

    it('should normalize UPPERCASE type names (IFCWALL -> IfcWall)', () => {
      const psets = getPsetDefinitionsForType('IFCWALL');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_WallCommon'), 'Should normalize IFCWALL to IfcWall');
    });

    it('should return empty array for unknown type', () => {
      const psets = getPsetDefinitionsForType('IfcUnknownType');
      assert.strictEqual(psets.length, 0);
    });

    it('should return building storey psets', () => {
      const psets = getPsetDefinitionsForType('IfcBuildingStorey');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_BuildingStoreyCommon'));
    });

    it('should return building psets', () => {
      const psets = getPsetDefinitionsForType('IfcBuilding');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_BuildingCommon'));
    });

    it('should include generic psets for IfcWallStandardCase', () => {
      const psets = getPsetDefinitionsForType('IfcWallStandardCase');
      const names = psets.map(p => p.name);
      assert.ok(names.includes('Pset_WallCommon'), 'WallStandardCase should get WallCommon');
      assert.ok(names.includes('Pset_Warranty'), 'Should get generic warranty pset');
    });
  });

  describe('getPsetDefinition', () => {
    it('should return a specific pset by name', () => {
      const pset = getPsetDefinition('Pset_WallCommon');
      assert.ok(pset);
      assert.strictEqual(pset.name, 'Pset_WallCommon');
      assert.ok(pset.properties.length > 0);
    });

    it('should return undefined for unknown pset', () => {
      const pset = getPsetDefinition('Pset_NonExistent');
      assert.strictEqual(pset, undefined);
    });
  });

  describe('getAllPsetDefinitions', () => {
    it('should return all definitions', () => {
      const all = getAllPsetDefinitions();
      assert.ok(all.length > 20, 'Should have many pset definitions');
    });
  });

  describe('isStandardPset', () => {
    it('should return true for standard pset names', () => {
      assert.ok(isStandardPset('Pset_WallCommon'));
      assert.ok(isStandardPset('Pset_DoorCommon'));
      assert.ok(isStandardPset('Pset_SlabCommon'));
    });

    it('should return false for custom pset names', () => {
      assert.ok(!isStandardPset('MyCustomPropertySet'));
      assert.ok(!isStandardPset('Pset_CustomThing'));
    });
  });

  describe('getPropertiesForPset', () => {
    it('should return properties for Pset_WallCommon', () => {
      const props = getPropertiesForPset('Pset_WallCommon');
      assert.ok(props.length > 0);
      const propNames = props.map(p => p.name);
      assert.ok(propNames.includes('IsExternal'));
      assert.ok(propNames.includes('LoadBearing'));
      assert.ok(propNames.includes('FireRating'));
      assert.ok(propNames.includes('ThermalTransmittance'));
    });

    it('should return empty array for unknown pset', () => {
      const props = getPropertiesForPset('Pset_Unknown');
      assert.strictEqual(props.length, 0);
    });

    it('should have proper types on properties', () => {
      const props = getPropertiesForPset('Pset_WallCommon');
      const isExternal = props.find(p => p.name === 'IsExternal');
      assert.ok(isExternal);
      // PropertyValueType.Boolean = 3
      assert.strictEqual(isExternal.type, 3);

      const thermalTransmittance = props.find(p => p.name === 'ThermalTransmittance');
      assert.ok(thermalTransmittance);
      // PropertyValueType.Real = 1
      assert.strictEqual(thermalTransmittance.type, 1);
    });
  });

  describe('CLASSIFICATION_SYSTEMS', () => {
    it('should contain common classification systems', () => {
      const names = CLASSIFICATION_SYSTEMS.map(c => c.name);
      assert.ok(names.includes('Uniclass 2015'));
      assert.ok(names.includes('OmniClass'));
      assert.ok(names.includes('MasterFormat'));
      assert.ok(names.includes('Custom'));
    });

    it('should have descriptions for all systems', () => {
      for (const system of CLASSIFICATION_SYSTEMS) {
        assert.ok(system.description, `${system.name} should have a description`);
      }
    });
  });
});
