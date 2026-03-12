/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Shared helpers for extracting typed values from IFC entity attributes.
 * Used across material, georef, and classification extractors.
 */

export function getString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return String(value);
}

export function getNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

export function getBoolean(value: unknown): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === '.T.' || value === 'T' || value === 'true') return true;
  if (value === '.F.' || value === 'F' || value === 'false') return false;
  return undefined;
}

export function getReference(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.startsWith('#')) {
    return parseInt(value.substring(1));
  }
  return undefined;
}

export function getReferences(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(v => getReference(v))
    .filter((ref): ref is number => ref !== undefined);
}

export function getStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map(v => getString(v))
    .filter((str): str is string => str !== undefined);
}
