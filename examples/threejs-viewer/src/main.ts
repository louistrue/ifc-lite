/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Minimal IFC viewer: @ifc-lite/geometry + Three.js
 *
 * This example demonstrates how to use @ifc-lite/geometry (the
 * engine-agnostic geometry layer) with Three.js instead of the
 * built-in WebGPU renderer.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GeometryProcessor } from '@ifc-lite/geometry';
import {
  addStreamingBatchToScene,
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
renderer.setPixelRatio(window.devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(20, 15, 20);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

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
    // Initialise WASM on first load
    await geometry.init();

    const buffer = new Uint8Array(await file.arrayBuffer());

    // Clear previous model
    clearScene();

    // Stream geometry — batches appear progressively
    let meshCount = 0;
    for await (const event of geometry.processStreaming(buffer)) {
      switch (event.type) {
        case 'batch':
          addStreamingBatchToScene(event.meshes, scene, expressIdMap);
          meshCount += event.meshes.length;
          status.textContent = `Loaded ${meshCount} meshes...`;
          break;

        case 'complete':
          fitCameraToScene();
          status.textContent = `${file.name} — ${event.totalMeshes} meshes`;
          break;
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
  expressIdMap.clear();
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
