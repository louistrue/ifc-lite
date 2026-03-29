/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * LocationMap — a compact MapLibre GL JS minimap that shows the model's
 * real-world position derived from IfcMapConversion + IfcProjectedCRS.
 *
 * Renders as a collapsible panel below the georeferencing fields.
 * Includes links to Google Maps, OpenStreetMap, and Google Earth (KMZ export).
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Map as MapIcon, ExternalLink, Loader2, MapPinOff, Globe2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo, GeometryResult } from '@ifc-lite/geometry';
import { GLTFExporter } from '@ifc-lite/export';
import { reprojectToLatLon, type LatLon } from '@/lib/geo/reproject';
import { buildKmz, ifcAngleToKmlHeading } from '@/lib/geo/kmz-exporter';

// Lazy-load maplibre-gl to avoid bloating the initial bundle
let maplibrePromise: Promise<typeof import('maplibre-gl')> | null = null;
function loadMaplibre() {
  if (!maplibrePromise) {
    maplibrePromise = import('maplibre-gl');
  }
  return maplibrePromise;
}

export interface LocationMapProps {
  mapConversion?: MapConversion;
  projectedCRS?: ProjectedCRS;
  /** Coordinate info from the model's GeometryResult (includes bounds and RTC offset) */
  coordinateInfo?: CoordinateInfo;
  /** Geometry result for KMZ export (optional — KMZ button hidden if not provided) */
  geometryResult?: GeometryResult | null;
}

type MapState = 'idle' | 'loading' | 'ready' | 'error';

export function LocationMap({ mapConversion, projectedCRS, coordinateInfo, geometryResult }: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<typeof import('maplibre-gl').Map> | null>(null);
  const markerRef = useRef<InstanceType<typeof import('maplibre-gl').Marker> | null>(null);

  const [mapState, setMapState] = useState<MapState>('idle');
  const [latLon, setLatLon] = useState<LatLon | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapConversion || !projectedCRS) {
      setLatLon(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setMapState('loading');
    setError(null);

    reprojectToLatLon(mapConversion, projectedCRS, coordinateInfo).then(result => {
      if (cancelled) return;
      if (result) {
        setLatLon(result);
        setMapState('ready');
      } else {
        setLatLon(null);
        setError('Could not resolve projection — EPSG code may be unsupported');
        setMapState('error');
      }
    });

    return () => { cancelled = true; };
  }, [mapConversion, projectedCRS, coordinateInfo]);

  // Initialize/update the map when we have a valid lat/lon
  useEffect(() => {
    if (!latLon || !containerRef.current) return;

    let cancelled = false;

    loadMaplibre().then(maplibregl => {
      if (cancelled || !containerRef.current) return;

      // If map already exists, just fly to new position
      if (mapRef.current) {
        mapRef.current.flyTo({ center: [latLon.lon, latLon.lat], zoom: 15, duration: 1200 });
        if (markerRef.current) {
          markerRef.current.setLngLat([latLon.lon, latLon.lat]);
        }
        return;
      }

      // Create new map
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
        center: [latLon.lon, latLon.lat],
        zoom: 15,
        attributionControl: false,
        interactive: true,
      });

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');

      // Add marker at model location
      const marker = new maplibregl.Marker({ color: '#14b8a6' })
        .setLngLat([latLon.lon, latLon.lat])
        .addTo(map);

      mapRef.current = map;
      markerRef.current = marker;
    });

    return () => {
      cancelled = true;
    };
  }, [latLon]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const googleMapsUrl = useMemo(() => {
    if (!latLon) return null;
    return `https://www.google.com/maps?q=${latLon.lat},${latLon.lon}`;
  }, [latLon]);

  const openStreetMapUrl = useMemo(() => {
    if (!latLon) return null;
    return `https://www.openstreetmap.org/?mlat=${latLon.lat}&mlon=${latLon.lon}#map=17/${latLon.lat}/${latLon.lon}`;
  }, [latLon]);

  const handleExportKmz = useCallback(() => {
    if (!latLon || !geometryResult || !mapConversion) return;
    try {
      const exporter = new GLTFExporter(geometryResult);
      const glb = new Uint8Array(exporter.exportGLB({ includeMetadata: true }));
      const heading = ifcAngleToKmlHeading(mapConversion.xAxisAbscissa, mapConversion.xAxisOrdinate);
      const kmz = buildKmz({
        latLon,
        altitude: mapConversion.orthogonalHeight,
        heading,
        glb,
        name: 'IFC Model',
      });
      const blob = new Blob([kmz], { type: 'application/vnd.google-earth.kmz' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'model.kmz';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('KMZ export failed:', err);
    }
  }, [latLon, geometryResult, mapConversion]);

  const isDarkRef = useRef(false);

  const handleStyleToggle = useCallback(() => {
    if (!mapRef.current) return;
    isDarkRef.current = !isDarkRef.current;
    mapRef.current.setStyle(
      isDarkRef.current
        ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
        : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    );
    // Re-add marker after style fully loads
    if (markerRef.current && mapRef.current) {
      mapRef.current.once('style.load', () => {
        if (markerRef.current && mapRef.current) {
          markerRef.current.addTo(mapRef.current);
        }
      });
    }
  }, []);

  // Nothing to show if no georeferencing data
  if (!mapConversion || !projectedCRS) {
    return null;
  }

  return (
    <div className="border-t border-zinc-100 dark:border-zinc-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <MapIcon className="h-3 w-3 text-teal-500 shrink-0" />
        <span className="font-bold text-[11px] text-zinc-700 dark:text-zinc-300 uppercase tracking-wide flex-1">
          Location
        </span>
        {latLon && (
          <span className="text-[10px] font-mono text-teal-600/70 dark:text-teal-500/60">
            {latLon.lat.toFixed(5)}, {latLon.lon.toFixed(5)}
          </span>
        )}
      </div>

      {/* Map container */}
      {mapState === 'loading' && (
        <div className="flex items-center justify-center h-[180px] bg-zinc-50 dark:bg-zinc-900/50">
          <Loader2 className="h-4 w-4 text-teal-500 animate-spin" />
          <span className="text-[10px] text-zinc-400 ml-2">Resolving coordinates...</span>
        </div>
      )}

      {mapState === 'error' && (
        <div className="flex items-center justify-center h-[60px] bg-zinc-50 dark:bg-zinc-900/50 gap-2 px-3">
          <MapPinOff className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
          <span className="text-[10px] text-zinc-400">{error}</span>
        </div>
      )}

      {(mapState === 'ready' || (mapState === 'loading' && latLon)) && (
        <>
          <div
            ref={containerRef}
            className="h-[180px] w-full [&_.maplibregl-ctrl-attrib]:!text-[7px] [&_.maplibregl-ctrl-attrib]:!bg-white/40 [&_.maplibregl-ctrl-attrib]:dark:!bg-black/30 [&_.maplibregl-ctrl-attrib]:!py-0 [&_.maplibregl-ctrl-attrib]:!px-1 [&_.maplibregl-ctrl-attrib]:!shadow-none [&_.maplibregl-ctrl-attrib]:!text-zinc-400/70 [&_.maplibregl-ctrl-attrib_a]:!text-zinc-400/70 [&_.maplibregl-ctrl-attrib]:!leading-normal"
            style={{ minHeight: 180 }}
          />

          {/* Action links */}
          <div className="flex items-center gap-3 px-3 py-1.5 border-t border-zinc-100 dark:border-zinc-900">
            {googleMapsUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    Google Maps
                  </a>
                </TooltipTrigger>
                <TooltipContent>Open model location in Google Maps</TooltipContent>
              </Tooltip>
            )}
            {openStreetMapUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={openStreetMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors"
                  >
                    <ExternalLink className="h-2.5 w-2.5" />
                    OpenStreetMap
                  </a>
                </TooltipTrigger>
                <TooltipContent>Open model location in OpenStreetMap</TooltipContent>
              </Tooltip>
            )}
            {geometryResult && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleExportKmz}
                    className="flex items-center gap-1 text-[10px] text-teal-600 dark:text-teal-400 hover:text-teal-800 dark:hover:text-teal-300 transition-colors"
                  >
                    <Globe2 className="h-2.5 w-2.5" />
                    Google Earth
                  </button>
                </TooltipTrigger>
                <TooltipContent>Download KMZ to open in Google Earth with model at correct position</TooltipContent>
              </Tooltip>
            )}
            <button
              onClick={handleStyleToggle}
              className="ml-auto text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            >
              Toggle style
            </button>
          </div>
        </>
      )}
    </div>
  );
}
