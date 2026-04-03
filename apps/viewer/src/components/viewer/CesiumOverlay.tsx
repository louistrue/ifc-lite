/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * CesiumOverlay — renders a CesiumJS globe behind the WebGPU canvas,
 * providing real-world 3D context (terrain, buildings, imagery) for
 * georeferenced IFC models.
 *
 * Architecture:
 *   - A separate <div> behind the WebGPU <canvas> (z-index layering)
 *   - WebGPU canvas uses transparent clear color so Cesium shows through
 *   - Camera is synchronized every frame from the IFC viewer camera
 *   - CesiumJS is lazy-loaded on first activation to avoid bundle bloat
 *   - User controls remain on the WebGPU canvas; Cesium's are disabled
 */

import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '@/store';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo } from '@ifc-lite/geometry';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { createCesiumBridge, type CesiumBridge } from '@/lib/geo/cesium-bridge';

// Lazy-loaded Cesium module and CSS
let cesiumPromise: Promise<typeof import('cesium')> | null = null;
function loadCesium() {
  if (!cesiumPromise) {
    cesiumPromise = Promise.all([
      import('cesium'),
      import('cesium/Build/Cesium/Widgets/widgets.css'),
    ]).then(([cesium]) => cesium);
  }
  return cesiumPromise;
}

export interface CesiumOverlayProps {
  mapConversion?: MapConversion;
  projectedCRS?: ProjectedCRS;
  coordinateInfo?: CoordinateInfo;
}

export function CesiumOverlay({
  mapConversion,
  projectedCRS,
  coordinateInfo,
}: CesiumOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<InstanceType<typeof import('cesium').Viewer> | null>(null);
  const bridgeRef = useRef<CesiumBridge | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const cesiumEnabled = useViewerStore((s) => s.cesiumEnabled);
  const dataSource = useViewerStore((s) => s.cesiumDataSource);
  const ionToken = useViewerStore((s) => s.cesiumIonToken);
  const terrainEnabled = useViewerStore((s) => s.cesiumTerrainEnabled);

  // Initialize/teardown Cesium viewer
  useEffect(() => {
    if (!cesiumEnabled || !mapConversion || !projectedCRS || !containerRef.current) {
      return;
    }

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      try {
        // 1. Create coordinate bridge
        const bridge = await createCesiumBridge(mapConversion, projectedCRS, coordinateInfo);
        if (cancelled || !bridge) {
          if (!cancelled) {
            setError('Could not resolve projection for Cesium overlay');
            setStatus('error');
          }
          return;
        }
        bridgeRef.current = bridge;

        // 2. Load CesiumJS
        const Cesium = await loadCesium();
        if (cancelled || !containerRef.current) return;

        // Configure Cesium ion token if provided
        if (ionToken) {
          Cesium.Ion.defaultAccessToken = ionToken;
        }

        // 3. Create viewer with minimal UI
        const viewer = new Cesium.Viewer(containerRef.current, {
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
          creditContainer: document.createElement('div'), // hide credits overlay
          msaaSamples: 1, // minimal — IFC canvas handles AA
          requestRenderMode: true, // only render when we ask
          maximumRenderTimeChange: Infinity, // never auto-render
          // Start with basic imagery; terrain/buildings added below
          baseLayer: false,
        });

        if (cancelled) {
          viewer.destroy();
          return;
        }

        // Disable all user input on Cesium (IFC canvas handles controls)
        const scene = viewer.scene;
        scene.screenSpaceCameraController.enableRotate = false;
        scene.screenSpaceCameraController.enableTranslate = false;
        scene.screenSpaceCameraController.enableZoom = false;
        scene.screenSpaceCameraController.enableTilt = false;
        scene.screenSpaceCameraController.enableLook = false;

        // Disable skybox/atmosphere for cleaner compositing
        if (scene.skyBox) (scene.skyBox as any).show = false;
        if (scene.sun) scene.sun.show = false;
        if (scene.moon) scene.moon.show = false;
        if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
        scene.backgroundColor = Cesium.Color.TRANSPARENT;
        scene.globe.baseColor = Cesium.Color.TRANSPARENT;

        // Add imagery layer
        try {
          const imageryProvider = await Cesium.IonImageryProvider.fromAssetId(2); // Bing Maps Aerial
          viewer.imageryLayers.addImageryProvider(imageryProvider);
        } catch {
          // Fall back to OpenStreetMap if Ion not available
          viewer.imageryLayers.addImageryProvider(
            new Cesium.OpenStreetMapImageryProvider({
              url: 'https://a.tile.openstreetmap.org/',
            })
          );
        }

        // Add terrain
        if (terrainEnabled && ionToken) {
          try {
            const terrainProvider = await Cesium.CesiumTerrainProvider.fromIonAssetId(1);
            viewer.terrainProvider = terrainProvider;
            scene.globe.depthTestAgainstTerrain = true;
          } catch {
            // terrain unavailable — continue without it
          }
        }

        // Add data source layer
        await addDataSourceLayer(Cesium, viewer, dataSource, ionToken);

        viewerRef.current = viewer;

        // 4. Fly to model location initially
        const { modelOrigin } = bridge;
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            modelOrigin.longitude,
            modelOrigin.latitude,
            modelOrigin.height + 200,
          ),
          orientation: {
            heading: 0,
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
          },
        });
        viewer.scene.requestRender();

        setStatus('ready');
      } catch (err) {
        if (!cancelled) {
          console.error('[CesiumOverlay] Init failed:', err);
          setError(err instanceof Error ? err.message : 'Cesium initialization failed');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
      bridgeRef.current = null;
      setStatus('idle');
    };
  }, [cesiumEnabled, mapConversion, projectedCRS, coordinateInfo, ionToken, terrainEnabled, dataSource]);

  // Camera sync loop: runs every frame when Cesium is ready
  useEffect(() => {
    if (status !== 'ready') return;

    const viewer = viewerRef.current;
    const bridge = bridgeRef.current;
    if (!viewer || !bridge) return;

    let cancelled = false;
    let Cesium: typeof import('cesium') | null = null;

    // We need Cesium module reference for Cartesian3/Math
    loadCesium().then((C) => {
      if (cancelled) return;
      Cesium = C;
    });

    function syncCamera() {
      if (cancelled) return;

      const renderer = getGlobalRenderer();
      if (!viewer || !bridge || !renderer || !Cesium) {
        rafRef.current = requestAnimationFrame(syncCamera);
        return;
      }

      const camera = renderer.getCamera();
      const camPos = camera.getPosition();
      const camTarget = camera.getTarget();
      const camUp = camera.getUp();

      const cesiumCam = bridge.viewerCameraToCesium(camPos, camTarget, camUp);
      if (cesiumCam) {
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            cesiumCam.position.longitude,
            cesiumCam.position.latitude,
            cesiumCam.position.height,
          ),
          orientation: {
            heading: cesiumCam.heading,
            pitch: cesiumCam.pitch,
            roll: cesiumCam.roll,
          },
        });
        viewer.scene.requestRender();
      }

      rafRef.current = requestAnimationFrame(syncCamera);
    }

    rafRef.current = requestAnimationFrame(syncCamera);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [status]);

  if (!cesiumEnabled || !mapConversion || !projectedCRS) {
    return null;
  }

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 z-0"
        style={{ pointerEvents: 'none' }}
      />
      {status === 'loading' && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded text-xs text-white font-mono">
          <div className="h-3 w-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Loading 3D context...
        </div>
      )}
      {status === 'error' && error && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-red-900/80 backdrop-blur-sm rounded text-xs text-red-200 font-mono">
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Add the selected 3D data source layer to the Cesium viewer.
 */
async function addDataSourceLayer(
  Cesium: typeof import('cesium'),
  viewer: InstanceType<typeof import('cesium').Viewer>,
  dataSource: string,
  ionToken: string,
) {
  try {
    switch (dataSource) {
      case 'osm-buildings': {
        if (!ionToken) return;
        const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(96188);
        viewer.scene.primitives.add(tileset);
        break;
      }
      case 'google-photorealistic': {
        // Google Photorealistic 3D Tiles via Cesium ion asset 2275207
        // Requires Cesium ion token with Google 3D Tiles enabled
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset();
          viewer.scene.primitives.add(tileset);
        } catch {
          // Fallback: try as Ion asset
          if (ionToken) {
            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
            viewer.scene.primitives.add(tileset);
          }
        }
        break;
      }
      case 'bing-aerial':
      default:
        // Bing aerial imagery is already added as the base layer
        break;
    }
  } catch (err) {
    console.warn('[CesiumOverlay] Failed to add data source:', dataSource, err);
  }
}
