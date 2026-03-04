/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Core types for IFC parsing
 */

import type { CompactEntityIndex } from './compact-entity-index.js';

export interface EntityRef {
  expressId: number;
  type: string;
  byteOffset: number;
  byteLength: number;
  lineNumber: number;
}

/**
 * Entity lookup interface — subset of Map used by consumers.
 * Satisfied by both Map<number, EntityRef> and CompactEntityIndex.
 */
export type EntityLookup = CompactEntityIndex | Map<number, EntityRef>;

export interface EntityIndex {
  byId: EntityLookup;
  byType: Map<string, number[]>;
}

/**
 * IFC attribute value - can be primitive, reference, or nested list
 * Uses `unknown` for runtime type checking in extractors
 */
export type IfcAttributeValue =
  | string
  | number
  | boolean
  | null
  | IfcAttributeValue[];

export interface IfcEntity {
  expressId: number;
  type: string;
  attributes: IfcAttributeValue[];
}

export interface PropertyValue {
  type: 'string' | 'number' | 'boolean' | 'null' | 'reference';
  value: string | number | boolean | null | number;
}

export interface PropertySet {
  name: string;
  properties: Map<string, PropertyValue>;
}

export interface Relationship {
  type: string;
  relatingObject: number;
  relatedObjects: number[];
  attributes?: Record<string, any>;
}

export interface ParseResult {
  entities: Map<number, IfcEntity>;
  propertySets: Map<number, PropertySet>;
  relationships: Relationship[];
  entityIndex: EntityIndex;
  fileSize: number;
  entityCount: number;
}
