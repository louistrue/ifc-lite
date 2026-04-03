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
 *
 * Live edit support:
 *   - When georef props change (e.g. user edits EPSG, eastings, rotation),
 *     the coordinate bridge is rebuilt and the globe flies to the new location
 *   - The Cesium viewer itself is NOT recreated — only the bridge is updated
 */

import { useEffect, useRef, useState } from 'react';
import { useViewerStore } from '@/store';
import type { MapConversion, ProjectedCRS } from '@ifc-lite/parser';
import type { CoordinateInfo, GeometryResult } from '@ifc-lite/geometry';
import { getGlobalRenderer } from '@/hooks/useBCF';
import { createCesiumBridge, type CesiumBridge } from '@/lib/geo/cesium-bridge';
import { GLTFExporter } from '@ifc-lite/export';

// Lazy-loaded Cesium module and CSS
let cesiumPromise: Promise<typeof import('cesium')> | null = null;
let cesiumModule: typeof import('cesium') | null = null;
function loadCesium() {
  if (!cesiumPromise) {
    cesiumPromise = Promise.all([
      import('cesium'),
      import('cesium/Build/Cesium/Widgets/widgets.css'),
    ]).then(([cesium]) => {
      cesiumModule = cesium;
      return cesium;
    });
  }
  return cesiumPromise;
}

export interface CesiumOverlayProps {
  mapConversion?: MapConversion;
  projectedCRS?: ProjectedCRS;
  coordinateInfo?: CoordinateInfo;
  /** Geometry result for loading the IFC model into Cesium as a glTF model. */
  geometryResult?: GeometryResult | null;
}

export function CesiumOverlay({
  mapConversion,
  projectedCRS,
  coordinateInfo,
  geometryResult,
}: CesiumOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<InstanceType<typeof import('cesium').Viewer> | null>(null);
  const bridgeRef = useRef<CesiumBridge | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  // Tracks bridge readiness as state (not just a ref) so terrain query effect re-runs
  const [bridgeVersion, setBridgeVersion] = useState(0);

  const cesiumEnabled = useViewerStore((s) => s.cesiumEnabled);
  const dataSource = useViewerStore((s) => s.cesiumDataSource);
  const ionToken = useViewerStore((s) => s.cesiumIonToken);
  const terrainEnabled = useViewerStore((s) => s.cesiumTerrainEnabled);
  const terrainClamp = useViewerStore((s) => s.cesiumTerrainClamp);
  const terrainHeight = useViewerStore((s) => s.cesiumTerrainHeight);
  const setCesiumTerrainHeight = useViewerStore((s) => s.setCesiumTerrainHeight);

  // Use refs so the camera sync loop always reads the latest values
  const terrainClampRef = useRef(terrainClamp);
  const terrainHeightRef = useRef(terrainHeight);
  terrainClampRef.current = terrainClamp;
  terrainHeightRef.current = terrainHeight;

  // Track the Cesium model primitive (IFC geometry loaded as glTF)
  const cesiumModelRef = useRef<any>(null);

  // ─── Effect 1: Create/destroy the Cesium viewer (heavy, rare) ───────────
  // Only depends on cesiumEnabled, ionToken, terrainEnabled, dataSource.
  // NOT on mapConversion/projectedCRS — those are handled by Effect 2.
  useEffect(() => {
    if (!cesiumEnabled || !containerRef.current) return;

    let cancelled = false;
    setStatus('loading');
    setError(null);

    (async () => {
      try {
        const Cesium = await loadCesium();
        if (cancelled || !containerRef.current) return;

        // Configure Cesium ion token if provided
        if (ionToken) {
          Cesium.Ion.defaultAccessToken = ionToken;
        }

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
          // Cesium ion ToS requires visible attribution — use a small container
          // at bottom of the overlay rather than hiding credits entirely.
          msaaSamples: 1,
          requestRenderMode: true,
          maximumRenderTimeChange: Infinity,
          baseLayer: false,
        });

        if (cancelled) { viewer.destroy(); return; }

        // CRITICAL: Fully disable Cesium's camera controller.
        // Without this, Cesium's ScreenSpaceCameraController fights against
        // our manually-set camera — it clamps to terrain, adjusts height,
        // and applies inertia, causing the model to slide along terrain.
        const scene = viewer.scene;
        const sscc = scene.screenSpaceCameraController;
        sscc.enableRotate = false;
        sscc.enableTranslate = false;
        sscc.enableZoom = false;
        sscc.enableTilt = false;
        sscc.enableLook = false;
        sscc.enableCollisionDetection = false;  // CRITICAL: prevents terrain clamping
        sscc.minimumZoomDistance = 0;
        sscc.maximumZoomDistance = Infinity;
        // Disable terrain-based camera adjustment
        scene.globe.depthTestAgainstTerrain = false;

        // Disable skybox/atmosphere/fog for transparent compositing
        if (scene.skyBox) (scene.skyBox as any).show = false;
        if (scene.sun) scene.sun.show = false;
        if (scene.moon) scene.moon.show = false;
        if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
        scene.fog.enabled = false;
        scene.globe.showGroundAtmosphere = false;
        scene.backgroundColor = Cesium.Color.TRANSPARENT;
        scene.globe.baseColor = Cesium.Color.TRANSPARENT;

        // Add imagery
        try {
          const imageryProvider = await Cesium.IonImageryProvider.fromAssetId(2);
          viewer.imageryLayers.addImageryProvider(imageryProvider);
        } catch {
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
          } catch { /* terrain unavailable */ }
        }

        // Add data source layer
        await addDataSourceLayer(Cesium, viewer, dataSource, ionToken);

        if (cancelled) { viewer.destroy(); return; }

        viewerRef.current = viewer;
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
  }, [cesiumEnabled, ionToken, terrainEnabled, dataSource]);

  // ─── Effect 2: Rebuild coordinate bridge when georef changes (fast) ─────
  // This is the live-edit handler. When the user changes EPSG, eastings,
  // northings, rotation, etc., we rebuild the bridge and fly to the new spot.
  useEffect(() => {
    if (status !== 'ready' || !mapConversion || !projectedCRS) {
      bridgeRef.current = null;
      return;
    }

    let cancelled = false;

    (async () => {
      const bridge = await createCesiumBridge(mapConversion, projectedCRS, coordinateInfo);
      if (cancelled) return;

      if (!bridge) {
        bridgeRef.current = null;
        return;
      }

      const prevBridge = bridgeRef.current;
      bridgeRef.current = bridge;
      // Bump version so terrain query effect re-runs now that bridge is ready
      setBridgeVersion((v) => v + 1);

      // Fly to the new model location (smooth animation)
      const viewer = viewerRef.current;
      const Cesium = cesiumModule;
      if (viewer && Cesium) {
        const { modelOrigin } = bridge;

        // Determine if this is a significant location change worth flying to
        const isFirstPosition = !prevBridge;
        const movedSignificantly = prevBridge && (
          Math.abs(modelOrigin.latitude - prevBridge.modelOrigin.latitude) > 0.00001 ||
          Math.abs(modelOrigin.longitude - prevBridge.modelOrigin.longitude) > 0.00001 ||
          Math.abs(modelOrigin.height - prevBridge.modelOrigin.height) > 1
        );

        if (isFirstPosition || movedSignificantly) {
          // Use the bridge's syncCamera with a default isometric view,
          // or fly to the new location on georef edit
          const target = Cesium.Cartesian3.fromDegrees(
            modelOrigin.longitude,
            modelOrigin.latitude,
            modelOrigin.height,
          );
          if (isFirstPosition) {
            const hpr = new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 300);
            viewer.camera.lookAt(target, hpr);
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          } else {
            viewer.camera.flyTo({
              destination: Cesium.Cartesian3.fromDegrees(
                modelOrigin.longitude, modelOrigin.latitude, modelOrigin.height + 200,
              ),
              orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
              duration: 1.5,
            });
          }
          viewer.scene.requestRender();
        }
      }
    })();

    return () => { cancelled = true; };
  }, [status, mapConversion, projectedCRS, coordinateInfo]);

  // ─── Effect 2b: Query terrain height when bridge is ready ───────────────
  // Also re-queries when terrainClamp is toggled on (in case first query failed)
  useEffect(() => {
    if (status !== 'ready') return;
    const bridge = bridgeRef.current;
    const viewer = viewerRef.current;
    const Cesium = cesiumModule;
    if (!bridge || !viewer || !Cesium) return;

    let cancelled = false;

    // Query immediately, then retry after a delay if terrain tiles weren't loaded yet
    const doQuery = () => {
      bridge.queryTerrainHeight(Cesium, viewer).then((h) => {
        if (!cancelled && h !== null) {
          setCesiumTerrainHeight(h);
        }
      });
    };

    // First attempt
    doQuery();
    // Retry after 5s in case terrain tiles were still loading
    const retryTimer = setTimeout(doQuery, 5000);

    return () => { cancelled = true; clearTimeout(retryTimer); };
  }, [status, terrainEnabled, terrainClamp, bridgeVersion]);

  // ─── Effect 2c: Load IFC model INTO Cesium as a glTF model ──────────────
  // This makes the IFC model a first-class Cesium entity with proper
  // depth testing against terrain and other 3D tiles (OSM buildings).
  useEffect(() => {
    if (status !== 'ready' || !geometryResult?.meshes?.length) return;
    const viewer = viewerRef.current;
    const bridge = bridgeRef.current;
    const Cesium = cesiumModule;
    if (!viewer || !bridge || !Cesium) return;

    let cancelled = false;

    (async () => {
      try {
        // Remove previous model if any
        if (cesiumModelRef.current) {
          viewer.scene.primitives.remove(cesiumModelRef.current);
          cesiumModelRef.current = null;
        }

        // Export IFC geometry as GLB
        const exporter = new GLTFExporter(geometryResult);
        const glbBytes = exporter.exportGLB();
        if (cancelled) return;

        // Build the model matrix: viewerToECEF
        // This positions the glTF geometry (which is in IFC viewer space)
        // at the correct ECEF location on the globe.
        const modelOriginCartesian = Cesium.Cartesian3.fromDegrees(
          bridge.modelOrigin.longitude,
          bridge.modelOrigin.latitude,
          bridge.modelOrigin.height,
        );
        const enuToEcef = Cesium.Transforms.eastNorthUpToFixedFrame(modelOriginCartesian);

        // Build viewerToENU 4x4 using the same rotation as the bridge
        const hScale = mapConversion?.scale ?? 1.0;
        const absc = mapConversion?.xAxisAbscissa ?? 1.0;
        const ordi = mapConversion?.xAxisOrdinate ?? 0.0;
        const shift = coordinateInfo?.originShift ?? { x: 0, y: 0, z: 0 };
        const rtc = coordinateInfo?.wasmRtcOffset;
        const rtcYup = rtc ? { x: rtc.x, y: rtc.z, z: -rtc.y } : { x: 0, y: 0, z: 0 };
        const bounds = coordinateInfo?.originalBounds;
        const modelVX = bounds ? (bounds.min.x + bounds.max.x) / 2 : 0;
        const modelVY = bounds ? (bounds.min.y + bounds.max.y) / 2 : 0;
        const modelVZ = bounds ? (bounds.min.z + bounds.max.z) / 2 : 0;

        // Viewer→ENU rotation columns (same as in bridge)
        const m00 = hScale * absc, m02 = hScale * ordi;
        const m10 = hScale * ordi, m12 = -hScale * absc;

        // Translation component (centers on model origin)
        const tx = m00 * (-modelVX) + m02 * (-modelVZ);
        const ty = m10 * (-modelVX) + m12 * (-modelVZ);
        const tz = -modelVY;

        // The GLB geometry has origin shift + RTC baked in by the geometry pipeline.
        // We need to account for the full offset from viewer (0,0,0) to world origin.
        // The viewer→ENU transform handles this via the translation.
        // But the GLB geometry vertices are in the SAME viewer space as the WebGPU renderer.
        const viewerToEnu = new Cesium.Matrix4(
          m00, 0, m02, tx,
          m10, 0, m12, ty,
          0,   1, 0,   tz,
          0,   0, 0,   1,
        );

        const modelMatrix = Cesium.Matrix4.multiply(
          enuToEcef, viewerToEnu, new Cesium.Matrix4(),
        );

        // Create a Blob URL for the GLB so Cesium can load it
        const blob = new Blob([glbBytes as BlobPart], { type: 'model/gltf-binary' });
        const glbUrl = URL.createObjectURL(blob);

        // Load as Cesium Model
        const model = await Cesium.Model.fromGltfAsync({
          url: glbUrl,
          modelMatrix: modelMatrix,
          shadows: Cesium.ShadowMode.DISABLED,
        });

        // Clean up the Blob URL after model is loaded
        URL.revokeObjectURL(glbUrl);

        if (cancelled) return;

        viewer.scene.primitives.add(model);
        cesiumModelRef.current = model;
        viewer.scene.requestRender();
      } catch (err) {
        console.warn('[CesiumOverlay] Failed to load IFC model into Cesium:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (cesiumModelRef.current && viewerRef.current) {
        viewerRef.current.scene.primitives.remove(cesiumModelRef.current);
        cesiumModelRef.current = null;
      }
    };
  }, [status, bridgeVersion, geometryResult]);

  // ─── Effect 3: Camera sync loop ─────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return;

    const viewer = viewerRef.current;
    if (!viewer) return;

    let cancelled = false;

    function syncCamera() {
      if (cancelled) return;

      const bridge = bridgeRef.current;
      const renderer = getGlobalRenderer();
      const Cesium = cesiumModule;
      if (!viewer || !bridge || !renderer || !Cesium) {
        rafRef.current = requestAnimationFrame(syncCamera);
        return;
      }

      const camera = renderer.getCamera();
      const camPos = camera.getPosition();
      const camTarget = camera.getTarget();
      const camUp = camera.getUp();
      const fov = camera.getFOV();

      // Compute terrain clamp offset: shift everything up so model sits on terrain
      // Uses refs to always read latest values without restarting the loop
      const currentClamp = terrainClampRef.current;
      const currentTerrainH = terrainHeightRef.current;
      const clampOffset = (currentClamp && currentTerrainH !== null)
        ? currentTerrainH - bridge.modelOrigin.height
        : undefined;

      // Sync Cesium camera: position, direction, up, right, FOV
      // All vectors transformed through Cesium's exact ENU→ECEF matrix
      bridge.syncCamera(Cesium, viewer, camPos, camTarget, camUp, fov, clampOffset);

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
        try {
          const tileset = await Cesium.createGooglePhotorealistic3DTileset();
          viewer.scene.primitives.add(tileset);
        } catch {
          if (ionToken) {
            const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(2275207);
            viewer.scene.primitives.add(tileset);
          }
        }
        break;
      }
      case 'bing-aerial':
      default:
        // No 3D tileset for Bing — imagery is added separately via imageryLayers
        break;
    }
  } catch (err) {
    console.warn('[CesiumOverlay] Failed to add data source:', dataSource, err);
  }
}
