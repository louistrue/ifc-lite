/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Types for IFC model diffing
 */

export type ChangeType = 'added' | 'deleted' | 'changed';

export interface DiffSettings {
  /** Compare entity attributes (Name, Description, ObjectType, etc.) */
  attributes?: boolean;
  /** Compare property sets and their values */
  properties?: boolean;
  /** Compare quantity sets and their values */
  quantities?: boolean;
}

export const DEFAULT_DIFF_SETTINGS: Required<DiffSettings> = {
  attributes: true,
  properties: true,
  quantities: true,
};

export interface AttributeChange {
  attribute: string;
  oldValue: string;
  newValue: string;
}

export interface PropertyChange {
  psetName: string;
  propName: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface QuantityChange {
  qsetName: string;
  quantityName: string;
  oldValue: number | null;
  newValue: number | null;
}

export interface EntityChange {
  globalId: string;
  expressId1: number;
  expressId2: number;
  type: string;
  name: string;
  attributeChanges: AttributeChange[];
  propertyChanges: PropertyChange[];
  quantityChanges: QuantityChange[];
}

export interface DiffResult {
  /** Elements present only in the new file */
  added: Array<{ globalId: string; expressId: number; type: string; name: string }>;
  /** Elements present only in the old file */
  deleted: Array<{ globalId: string; expressId: number; type: string; name: string }>;
  /** Elements present in both files with detected modifications */
  changed: EntityChange[];
  /** Summary statistics */
  summary: {
    totalAdded: number;
    totalDeleted: number;
    totalChanged: number;
    totalUnchanged: number;
  };
}

/**
 * Color presets for visual diff rendering.
 * RGBA tuples in [0-1] range.
 */
export const DIFF_COLORS = {
  added: [0.18, 0.8, 0.34, 1.0] as [number, number, number, number],    // green
  changed: [1.0, 0.6, 0.0, 1.0] as [number, number, number, number],    // orange
  deleted: [0.9, 0.2, 0.2, 0.35] as [number, number, number, number],   // red, ghosted
  unchanged: [0.7, 0.7, 0.7, 0.15] as [number, number, number, number], // grey, ghosted
} as const;
