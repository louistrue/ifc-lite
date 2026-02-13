/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Maps a list ColumnDefinition to a lens AutoColorSpec.
 * This bridges the lists feature (column-based data tables) with
 * the lens feature (3D coloring) by converting column metadata
 * into the auto-color specification used by the lens engine.
 */

import type { ColumnDefinition } from '@ifc-lite/lists';
import type { AutoColorSpec } from '@ifc-lite/lens';

/**
 * Convert a list column definition to an auto-color spec.
 *
 * @param col - Column definition from a list configuration
 * @returns AutoColorSpec for the lens engine
 */
export function columnToAutoColor(col: ColumnDefinition): AutoColorSpec {
  switch (col.source) {
    case 'attribute':
      if (col.propertyName === 'Class') return { source: 'ifcType' };
      return { source: 'attribute', propertyName: col.propertyName };
    case 'property':
      return { source: 'property', psetName: col.psetName, propertyName: col.propertyName };
    case 'quantity':
      return { source: 'quantity', psetName: col.psetName, propertyName: col.propertyName };
    default:
      return { source: 'ifcType' };
  }
}
