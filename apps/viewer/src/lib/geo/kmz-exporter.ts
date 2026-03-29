/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * KMZ Exporter — packages a GLB model with a KML file into a KMZ archive
 * so Google Earth can display the 3D model at its correct geolocation.
 *
 * KMZ is just a ZIP archive containing:
 *   doc.kml   — KML document with a <Model> positioned at lat/lon/alt
 *   model.glb — the 3D model in glTF binary format
 *
 * The KML <Model> element uses:
 *   <Location>    — latitude, longitude, altitude from reprojected georef
 *   <Orientation> — heading derived from the angle-to-grid-north
 *   <Scale>       — uniform scale (1:1)
 *   <Link>        — relative path to the GLB inside the archive
 */

import { zipSync } from 'fflate';
import type { LatLon } from './reproject';

export interface KmzOptions {
  /** WGS84 coordinates of the model origin */
  latLon: LatLon;
  /** Orthogonal height (elevation) in metres */
  altitude: number;
  /** Heading in degrees clockwise from north (0 = north, 90 = east) */
  heading: number;
  /** GLB model binary data */
  glb: Uint8Array;
  /** Display name for the placemark */
  name?: string;
}

/**
 * Convert the IFC angle-to-grid-north (counterclockwise from east) into
 * a KML heading (clockwise from north).
 *
 * IFC convention: atan2(XAxisOrdinate, XAxisAbscissa) gives the CCW angle
 * from the map east axis to the local X axis.
 *
 * KML convention: heading is CW from north (0=N, 90=E, 180=S, 270=W).
 */
export function ifcAngleToKmlHeading(
  xAxisAbscissa?: number,
  xAxisOrdinate?: number,
): number {
  if (xAxisAbscissa === undefined || xAxisOrdinate === undefined) return 0;
  const angleFromEastCcw = Math.atan2(xAxisOrdinate, xAxisAbscissa) * (180 / Math.PI);
  // Convert: heading = 90 - angle (CCW from east → CW from north)
  const heading = 90 - angleFromEastCcw;
  // Normalize to [0, 360)
  return ((heading % 360) + 360) % 360;
}

function buildKml(opts: KmzOptions): string {
  const name = escapeXml(opts.name ?? 'IFC Model');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${name}</name>
    <Placemark>
      <name>${name}</name>
      <Model id="model">
        <altitudeMode>relativeToGround</altitudeMode>
        <Location>
          <longitude>${opts.latLon.lon}</longitude>
          <latitude>${opts.latLon.lat}</latitude>
          <altitude>${opts.altitude}</altitude>
        </Location>
        <Orientation>
          <heading>${opts.heading}</heading>
          <tilt>0</tilt>
          <roll>0</roll>
        </Orientation>
        <Scale>
          <x>1</x>
          <y>1</y>
          <z>1</z>
        </Scale>
        <Link>
          <href>model.glb</href>
        </Link>
      </Model>
    </Placemark>
  </Document>
</kml>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a KMZ file (ZIP archive) containing doc.kml + model.glb.
 * Returns the KMZ as a Uint8Array ready for download.
 */
export function buildKmz(opts: KmzOptions): Uint8Array {
  const kml = buildKml(opts);
  const kmlBytes = new TextEncoder().encode(kml);

  return zipSync({
    'doc.kml': kmlBytes,
    'model.glb': opts.glb,
  });
}
