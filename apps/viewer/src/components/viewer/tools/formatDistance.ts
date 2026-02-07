/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Format a distance in meters to a human-readable string with appropriate units
 */
export function formatDistance(meters: number): string {
  if (meters < 0.01) {
    return `${(meters * 1000).toFixed(1)} mm`;
  } else if (meters < 1) {
    return `${(meters * 100).toFixed(1)} cm`;
  } else if (meters < 1000) {
    return `${meters.toFixed(2)} m`;
  } else {
    return `${(meters / 1000).toFixed(2)} km`;
  }
}
