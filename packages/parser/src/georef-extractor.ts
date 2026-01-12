/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Georeferencing Extractor
 *
 * Extracts IFC georeferencing information for coordinate system transformations.
 *
 * IFC georeferencing concepts:
 * - IfcMapConversion: Transformation from local engineering CRS to map CRS
 * - IfcProjectedCRS: Target coordinate reference system (e.g., UTM, State Plane)
 * - IfcGeometricRepresentationContext: Context with coordinate system info
 *
 * This enables:
 * - Converting IFC coordinates to real-world coordinates (lat/lon or projected)
 * - Integration with GIS systems
 * - Multi-model coordination (ensuring models align in real-world space)
 */

import type { IfcEntity } from './entity-extractor';

export interface MapConversion {
  id: number;
  sourceCRS: number;  // GeometricRepresentationContext ID
  targetCRS: number;  // ProjectedCRS ID
  eastings: number;   // False easting (X offset)
  northings: number;  // False northing (Y offset)
  orthogonalHeight: number;  // Z offset
  xAxisAbscissa?: number;    // X-axis direction (rotation)
  xAxisOrdinate?: number;    // X-axis direction (rotation)
  scale?: number;            // Scale factor
}

export interface ProjectedCRS {
  id: number;
  name: string;
  description?: string;
  geodeticDatum?: string;     // e.g., "WGS84", "NAD83"
  verticalDatum?: string;     // e.g., "NAVD88", "MSL"
  mapProjection?: string;     // e.g., "UTM Zone 10N"
  mapZone?: string;           // e.g., "10N"
  mapUnit?: string;           // e.g., "METRE"
}

export interface GeoreferenceInfo {
  hasGeoreference: boolean;
  mapConversion?: MapConversion;
  projectedCRS?: ProjectedCRS;
  // Computed transformation matrix (4x4) from local to world coordinates
  transformMatrix?: number[];
}

/**
 * Extract georeferencing information from IFC entities
 */
export function extractGeoreferencing(
  entities: Map<number, IfcEntity>,
  entitiesByType: Map<string, number[]>
): GeoreferenceInfo {
  const info: GeoreferenceInfo = {
    hasGeoreference: false,
  };

  // Extract IfcMapConversion
  const mapConversionIds = entitiesByType.get('IfcMapConversion') || [];
  if (mapConversionIds.length > 0) {
    const entity = entities.get(mapConversionIds[0]);
    if (entity) {
      info.mapConversion = extractMapConversion(entity);
      info.hasGeoreference = true;
    }
  }

  // Extract IfcProjectedCRS
  const projectedCRSIds = entitiesByType.get('IfcProjectedCRS') || [];
  if (projectedCRSIds.length > 0) {
    const entity = entities.get(projectedCRSIds[0]);
    if (entity) {
      info.projectedCRS = extractProjectedCRS(entity);
      info.hasGeoreference = true;
    }
  }

  // Compute transformation matrix if we have map conversion
  if (info.mapConversion) {
    info.transformMatrix = computeTransformMatrix(info.mapConversion);
  }

  return info;
}

function extractMapConversion(entity: IfcEntity): MapConversion {
  // IfcMapConversion attributes (IFC4):
  // [0] SourceCRS (IfcCoordinateReferenceSystem)
  // [1] TargetCRS (IfcCoordinateReferenceSystem)
  // [2] Eastings (IfcLengthMeasure)
  // [3] Northings (IfcLengthMeasure)
  // [4] OrthogonalHeight (IfcLengthMeasure)
  // [5] XAxisAbscissa (OPTIONAL IfcReal)
  // [6] XAxisOrdinate (OPTIONAL IfcReal)
  // [7] Scale (OPTIONAL IfcReal)

  return {
    id: entity.id,
    sourceCRS: getReference(entity.attributes[0]) || 0,
    targetCRS: getReference(entity.attributes[1]) || 0,
    eastings: getNumber(entity.attributes[2]) || 0,
    northings: getNumber(entity.attributes[3]) || 0,
    orthogonalHeight: getNumber(entity.attributes[4]) || 0,
    xAxisAbscissa: getNumber(entity.attributes[5]),
    xAxisOrdinate: getNumber(entity.attributes[6]),
    scale: getNumber(entity.attributes[7]),
  };
}

function extractProjectedCRS(entity: IfcEntity): ProjectedCRS {
  // IfcProjectedCRS attributes (IFC4):
  // [0] Name (IfcLabel)
  // [1] Description (OPTIONAL IfcText)
  // [2] GeodeticDatum (OPTIONAL IfcIdentifier)
  // [3] VerticalDatum (OPTIONAL IfcIdentifier)
  // [4] MapProjection (OPTIONAL IfcIdentifier)
  // [5] MapZone (OPTIONAL IfcIdentifier)
  // [6] MapUnit (OPTIONAL IfcNamedUnit)

  // Parse MapUnit if it's a reference
  let mapUnit: string | undefined;
  const mapUnitRef = getReference(entity.attributes[6]);
  if (mapUnitRef) {
    // Would need to resolve the IfcNamedUnit entity
    mapUnit = 'METRE'; // Default assumption
  }

  return {
    id: entity.id,
    name: getString(entity.attributes[0]) || '',
    description: getString(entity.attributes[1]),
    geodeticDatum: getString(entity.attributes[2]),
    verticalDatum: getString(entity.attributes[3]),
    mapProjection: getString(entity.attributes[4]),
    mapZone: getString(entity.attributes[5]),
    mapUnit,
  };
}

/**
 * Compute 4x4 transformation matrix from local to world coordinates
 */
function computeTransformMatrix(mapConversion: MapConversion): number[] {
  const { eastings, northings, orthogonalHeight, xAxisAbscissa, xAxisOrdinate, scale } = mapConversion;

  // Default scale to 1.0 if not specified
  const s = scale || 1.0;

  // Compute rotation angle from X-axis direction
  let angle = 0;
  if (xAxisAbscissa !== undefined && xAxisOrdinate !== undefined) {
    angle = Math.atan2(xAxisOrdinate, xAxisAbscissa);
  }

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Build 4x4 transformation matrix:
  // [scale*cos  -scale*sin  0  eastings  ]
  // [scale*sin   scale*cos  0  northings ]
  // [0           0          1  height    ]
  // [0           0          0  1         ]

  return [
    s * cos,  s * sin,  0,  0,
    -s * sin, s * cos,  0,  0,
    0,        0,        1,  0,
    eastings, northings, orthogonalHeight, 1,
  ];
}

/**
 * Transform a point from local to world coordinates
 */
export function transformToWorld(
  localPoint: [number, number, number],
  georef: GeoreferenceInfo
): [number, number, number] | null {
  if (!georef.transformMatrix) {
    return null;
  }

  const [x, y, z] = localPoint;
  const m = georef.transformMatrix;

  // Apply transformation: [x', y', z', 1] = [x, y, z, 1] * M
  const xWorld = m[0] * x + m[4] * y + m[8] * z + m[12];
  const yWorld = m[1] * x + m[5] * y + m[9] * z + m[13];
  const zWorld = m[2] * x + m[6] * y + m[10] * z + m[14];

  return [xWorld, yWorld, zWorld];
}

/**
 * Transform a point from world to local coordinates
 */
export function transformToLocal(
  worldPoint: [number, number, number],
  georef: GeoreferenceInfo
): [number, number, number] | null {
  if (!georef.transformMatrix) {
    return null;
  }

  // Compute inverse transformation
  const m = georef.transformMatrix;
  const [xWorld, yWorld, zWorld] = worldPoint;

  // Extract rotation and scale
  const scale = georef.mapConversion?.scale || 1.0;
  const angle = Math.atan2(m[1], m[0]);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const invScale = 1.0 / scale;

  // Apply inverse translation
  const xTrans = xWorld - m[12];
  const yTrans = yWorld - m[13];
  const zTrans = zWorld - m[14];

  // Apply inverse rotation and scale
  const x = invScale * (cos * xTrans - sin * yTrans);
  const y = invScale * (sin * xTrans + cos * yTrans);
  const z = zTrans;

  return [x, y, z];
}

/**
 * Get coordinate system description
 */
export function getCoordinateSystemDescription(georef: GeoreferenceInfo): string {
  if (!georef.hasGeoreference) {
    return 'Local Engineering Coordinates';
  }

  const parts: string[] = [];

  if (georef.projectedCRS) {
    parts.push(georef.projectedCRS.name);
    if (georef.projectedCRS.mapProjection) {
      parts.push(`(${georef.projectedCRS.mapProjection})`);
    }
    if (georef.projectedCRS.geodeticDatum) {
      parts.push(`Datum: ${georef.projectedCRS.geodeticDatum}`);
    }
  }

  if (georef.mapConversion) {
    const { eastings, northings, orthogonalHeight } = georef.mapConversion;
    parts.push(`Origin: (${eastings.toFixed(2)}, ${northings.toFixed(2)}, ${orthogonalHeight.toFixed(2)})`);
  }

  return parts.join(' ');
}

// Helper functions

function getString(value: any): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return String(value);
}

function getNumber(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

function getReference(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.startsWith('#')) {
    return parseInt(value.substring(1));
  }
  return undefined;
}
