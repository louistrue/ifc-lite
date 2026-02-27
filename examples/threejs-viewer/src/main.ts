/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Minimal IFC viewer: @ifc-lite/geometry + Three.js
 *
 * Loading strategy:
 *  1. Each streaming batch is vertex-color-batched and added to the scene
 *     immediately — the model appears progressively as it streams in.
 *  2. On 'complete', the full model is rebuilt as a single optimised mesh
 *     (1 opaque draw call + a few transparent ones). The batch groups are
 *     disposed one frame later so there is no visual pop.
 *
 * This example demonstrates how to use @ifc-lite/geometry (the
 * engine-agnostic geometry layer) with Three.js instead of the
 * built-in WebGPU renderer.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GeometryProcessor, type MeshData } from '@ifc-lite/geometry';
import {
  batchWithVertexColors,
  type ExpressIdMap,
} from './ifc-to-threejs.js';

// ── DOM elements ──────────────────────────────────────────────────────
const canvas = document.getElementById('viewer');
const fileInput = document.getElementById('file-input');
const status = document.getElementById('status');

if (!canvas || !fileInput || !status) {
  throw new Error('Required DOM elements not found: viewer, file-input, or status');
}

// ── Three.js setup ────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Cap pixel ratio — retina at full res is expensive on large models
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(20, 15, 20);

const controls = new OrbitControls(camera, canvas);
// No damping — camera stops sharply when the user releases
controls.enableDamping = false;

// ── Lighting ──────────────────────────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(50, 80, 50);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xb0c4de, 0.3);
fillLight.position.set(-30, 10, -20);
scene.add(fillLight);

// ── IFC-Lite geometry processor ───────────────────────────────────────
const geometry = new GeometryProcessor();
const expressIdMap: ExpressIdMap = new Map();

// ── Resize handling ───────────────────────────────────────────────────
function resize() {
  const container = canvas.parentElement ?? document.body;
  renderer.setSize(container.clientWidth, container.clientHeight);
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ── Render loop ───────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ── File loading ──────────────────────────────────────────────────────
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  status.textContent = `Loading ${file.name}...`;

  try {
    await geometry.init();

    const buffer = new Uint8Array(await file.arrayBuffer());

    clearScene();

    // allMeshes accumulates every entity for the final optimised merge.
    // batchGroups tracks the per-batch preview meshes added during streaming.
    const allMeshes: MeshData[] = [];
    const batchGroups: THREE.Group[] = [];

    for await (const event of geometry.processStreaming(buffer)) {
      switch (event.type) {
        case 'batch': {
          allMeshes.push(...event.meshes);

          // Each batch is immediately batched by vertex color and shown —
          // the model appears progressively while streaming continues.
          const { group } = batchWithVertexColors(event.meshes);
          scene.add(group);
          batchGroups.push(group);

          status.textContent = `Streaming… ${allMeshes.length} meshes`;
          break;
        }

        case 'complete': {
          // Build the single optimised mesh for the whole model:
          // opaque → 1 draw call, transparent → grouped by alpha.
          const { group: finalGroup, expressIdMap: newMap } =
            batchWithVertexColors(allMeshes);

          scene.add(finalGroup);
          for (const [id, mesh] of newMap) expressIdMap.set(id, mesh);

          fitCameraToScene();

          // Dispose the per-batch preview groups one frame later so
          // there is no visual gap between the two representations.
          requestAnimationFrame(() => {
            for (const g of batchGroups) {
              scene.remove(g);
              disposeGroup(g);
            }
            batchGroups.length = 0;

            renderer.render(scene, camera);
            const calls = renderer.info.render.calls;
            status.textContent =
              `${file.name} — ${event.totalMeshes} meshes · ${calls} draw calls`;
          });
          break;
        }
      }
    }
  } catch (err) {
    console.error(err);
    status.textContent = `Error: ${(err as Error).message}`;
  }
});

// ── Helpers ───────────────────────────────────────────────────────────
function clearScene() {
  const toRemove = scene.children.filter(
    (obj) => obj instanceof THREE.Mesh || obj instanceof THREE.Group,
  );
  for (const obj of toRemove) {
    scene.remove(obj);
    disposeGroup(obj);
  }
  expressIdMap.clear();
}

/** Recursively dispose geometry and materials of a scene subtree. */
function disposeGroup(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function fitCameraToScene() {
  const box = new THREE.Box3().setFromObject(scene);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const distance = maxDim * 1.5;

  camera.position.set(
    center.x + distance * 0.5,
    center.y + distance * 0.5,
    center.z + distance * 0.5,
  );
  controls.target.copy(center);
  controls.update();

  camera.near = maxDim * 0.001;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();
}
