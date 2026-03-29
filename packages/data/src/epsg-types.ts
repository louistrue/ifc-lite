/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export type EpsgKind =
  | 'Projected'
  | 'Geographic'
  | 'Compound'
  | 'Vertical'
  | 'Engineering'
  | 'Geocentric'
  | 'Derived'
  | 'Unknown';

export interface EpsgIndexEntry {
  code: string;
  name: string;
  kind: EpsgKind | string;
  area: string;
  scope: string;
  datum: string;
  projection: string;
  unit: string;
  deprecated: boolean;
  aliases: string[];
  searchText: string;
}

export interface SearchEpsgIndexOptions {
  includeDeprecated?: boolean;
  limit?: number;
}

export interface LookupEpsgByCodeOptions {
  prefix?: boolean;
  includeDeprecated?: boolean;
  limit?: number;
}
