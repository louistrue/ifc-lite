/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * 3D viewport component
 */

import { useEffect, useRef, useState } from 'react';
import { Renderer, MathUtils } from '@ifc-lite/renderer';
import type { MeshData, CoordinateInfo } from '@ifc-lite/geometry';
import { useViewerStore } from '../store.js';

interface ViewportProps {
    geometry: MeshData[] | null;
    coordinateInfo?: CoordinateInfo;
}

export function Viewport({ geometry, coordinateInfo }: ViewportProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
    const setSelectedEntityId = useViewerStore((state) => state.setSelectedEntityId);

    // Animation frame ref
    const animationFrameRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number>(0);

    // Mouse state
    const mouseStateRef = useRef({
        isDragging: false,
        isPanning: false,
        lastX: 0,
        lastY: 0,
        button: 0, // 0 = left, 1 = middle, 2 = right
    });

    // Touch state
    const touchStateRef = useRef({
        touches: [] as Touch[],
        lastDistance: 0,
        lastCenter: { x: 0, y: 0 },
    });

    // Double-click detection
    const lastClickTimeRef = useRef<number>(0);
    const lastClickPosRef = useRef<{ x: number; y: number } | null>(null);

    // Keyboard handlers refs
    const keyboardHandlersRef = useRef<{
        handleKeyDown: ((e: KeyboardEvent) => void) | null;
        handleKeyUp: ((e: KeyboardEvent) => void) | null;
    }>({ handleKeyDown: null, handleKeyUp: null });

    // First-person mode state
    const firstPersonModeRef = useRef<boolean>(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Reset initialized state at start of effect (important for HMR)
        setIsInitialized(false);

        // Abort flag to prevent stale async operations from completing
        let aborted = false;
        let resizeObserver: ResizeObserver | null = null;

        // Set canvas pixel dimensions from CSS dimensions before init
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));
        canvas.width = width;
        canvas.height = height;

        const renderer = new Renderer(canvas);
        rendererRef.current = renderer;

        renderer.init().then(() => {
            // Skip if component was unmounted during async init
            if (aborted) {
                return;
            }
            console.log('[Viewport] Renderer initialized');
            setIsInitialized(true);

            const camera = renderer.getCamera();
            const mouseState = mouseStateRef.current;
            const touchState = touchStateRef.current;

            // Animation loop for camera inertia
            const animate = (currentTime: number) => {
                if (aborted) return;

                const deltaTime = currentTime - lastFrameTimeRef.current;
                lastFrameTimeRef.current = currentTime;

                const isAnimating = camera.update(deltaTime);
                if (isAnimating) {
                    renderer.render();
                }

                animationFrameRef.current = requestAnimationFrame(animate);
            };
            lastFrameTimeRef.current = performance.now();
            animationFrameRef.current = requestAnimationFrame(animate);

            // Mouse controls
            canvas.addEventListener('mousedown', (e) => {
                e.preventDefault();
                mouseState.isDragging = true;
                mouseState.isPanning = e.button === 1 || e.button === 2 || e.shiftKey;
                mouseState.button = e.button;
                mouseState.lastX = e.clientX;
                mouseState.lastY = e.clientY;
                canvas.style.cursor = mouseState.isPanning ? 'move' : 'grab';
            });

            canvas.addEventListener('mousemove', (e) => {
                if (mouseState.isDragging) {
                    const dx = e.clientX - mouseState.lastX;
                    const dy = e.clientY - mouseState.lastY;

                    if (mouseState.isPanning) {
                        camera.pan(dx, dy, false);
                    } else {
                        camera.orbit(dx, dy, false);
                    }

                    mouseState.lastX = e.clientX;
                    mouseState.lastY = e.clientY;
                    renderer.render();
                }
            });

            canvas.addEventListener('mouseup', () => {
                mouseState.isDragging = false;
                mouseState.isPanning = false;
                canvas.style.cursor = 'default';
            });

            canvas.addEventListener('mouseleave', () => {
                mouseState.isDragging = false;
                mouseState.isPanning = false;
                camera.stopInertia();
                canvas.style.cursor = 'default';
            });

            // Prevent context menu on right-click
            canvas.addEventListener('contextmenu', (e) => {
                e.preventDefault();
            });

            // Wheel zoom - zoom towards mouse position
            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                camera.zoom(e.deltaY, false, mouseX, mouseY, canvas.width, canvas.height);
                renderer.render();
            });

            // Click and double-click
            canvas.addEventListener('click', async (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                const now = Date.now();
                const timeSinceLastClick = now - lastClickTimeRef.current;
                const clickPos = { x, y };

                // Check for double-click
                if (lastClickPosRef.current &&
                    timeSinceLastClick < 300 &&
                    Math.abs(clickPos.x - lastClickPosRef.current.x) < 5 &&
                    Math.abs(clickPos.y - lastClickPosRef.current.y) < 5) {
                    // Double-click: zoom to fit selected element
                    const pickedId = await renderer.pick(x, y);
                    if (pickedId) {
                        setSelectedEntityId(pickedId);
                        // Find bounds of selected element (simplified - would need scene bounds)
                        const meshes = renderer.getScene().getMeshes();
                        const selectedMesh = meshes.find(m => m.expressId === pickedId);
                        if (selectedMesh) {
                            // For now, just zoom to current bounds
                            // In production, would calculate element bounds
                            const bounds = {
                                min: { x: -10, y: -10, z: -10 },
                                max: { x: 10, y: 10, z: 10 },
                            };
                            camera.zoomToFit(bounds.min, bounds.max, 500);
                        }
                    }
                    lastClickTimeRef.current = 0;
                    lastClickPosRef.current = null;
                } else {
                    // Single click: pick element
                    console.log('[Viewport] Click at:', { x, y });
                    const pickedId = await renderer.pick(x, y);
                    console.log('[Viewport] Picked expressId:', pickedId);
                    setSelectedEntityId(pickedId);
                    lastClickTimeRef.current = now;
                    lastClickPosRef.current = clickPos;
                }
            });

            // Touch controls
            canvas.addEventListener('touchstart', (e) => {
                e.preventDefault();
                touchState.touches = Array.from(e.touches);

                if (touchState.touches.length === 1) {
                    touchState.lastCenter = {
                        x: touchState.touches[0].clientX,
                        y: touchState.touches[0].clientY,
                    };
                } else if (touchState.touches.length === 2) {
                    const dx = touchState.touches[1].clientX - touchState.touches[0].clientX;
                    const dy = touchState.touches[1].clientY - touchState.touches[0].clientY;
                    touchState.lastDistance = Math.sqrt(dx * dx + dy * dy);
                    touchState.lastCenter = {
                        x: (touchState.touches[0].clientX + touchState.touches[1].clientX) / 2,
                        y: (touchState.touches[0].clientY + touchState.touches[1].clientY) / 2,
                    };
                }
            });

            canvas.addEventListener('touchmove', (e) => {
                e.preventDefault();
                touchState.touches = Array.from(e.touches);

                if (touchState.touches.length === 1) {
                    // Single finger: orbit
                    const dx = touchState.touches[0].clientX - touchState.lastCenter.x;
                    const dy = touchState.touches[0].clientY - touchState.lastCenter.y;
                    camera.orbit(dx, dy, false);
                    touchState.lastCenter = {
                        x: touchState.touches[0].clientX,
                        y: touchState.touches[0].clientY,
                    };
                    renderer.render();
                } else if (touchState.touches.length === 2) {
                    // Two fingers: pan and zoom
                    const dx1 = touchState.touches[1].clientX - touchState.touches[0].clientX;
                    const dy1 = touchState.touches[1].clientY - touchState.touches[0].clientY;
                    const distance = Math.sqrt(dx1 * dx1 + dy1 * dy1);

                    // Pan
                    const centerX = (touchState.touches[0].clientX + touchState.touches[1].clientX) / 2;
                    const centerY = (touchState.touches[0].clientY + touchState.touches[1].clientY) / 2;
                    const panDx = centerX - touchState.lastCenter.x;
                    const panDy = centerY - touchState.lastCenter.y;
                    camera.pan(panDx, panDy, false);

                    // Zoom (pinch) towards center of pinch gesture
                    const zoomDelta = distance - touchState.lastDistance;
                    const rect = canvas.getBoundingClientRect();
                    camera.zoom(zoomDelta * 10, false, centerX - rect.left, centerY - rect.top, canvas.width, canvas.height);

                    touchState.lastDistance = distance;
                    touchState.lastCenter = { x: centerX, y: centerY };
                    renderer.render();
                }
            });

            canvas.addEventListener('touchend', (e) => {
                e.preventDefault();
                touchState.touches = Array.from(e.touches);
                if (touchState.touches.length === 0) {
                    camera.stopInertia();
                }
            });

            // Keyboard controls
            const keyState: { [key: string]: boolean } = {};

            const handleKeyDown = (e: KeyboardEvent) => {
                // Only handle if canvas is focused or no input is focused
                if (document.activeElement?.tagName === 'INPUT' ||
                    document.activeElement?.tagName === 'TEXTAREA') {
                    return;
                }

                keyState[e.key.toLowerCase()] = true;

                // Preset views
                if (e.key === '1') camera.setPresetView('top');
                if (e.key === '2') camera.setPresetView('bottom');
                if (e.key === '3') camera.setPresetView('front');
                if (e.key === '4') camera.setPresetView('back');
                if (e.key === '5') camera.setPresetView('left');
                if (e.key === '6') camera.setPresetView('right');

                // Frame selection
                if (e.key === 'f' || e.key === 'F') {
                    if (selectedEntityId) {
                        const bounds = {
                            min: { x: -10, y: -10, z: -10 },
                            max: { x: 10, y: 10, z: 10 },
                        };
                        camera.zoomToFit(bounds.min, bounds.max, 500);
                    }
                }

                // Home view (reset)
                if (e.key === 'h' || e.key === 'H') {
                    const bounds = {
                        min: { x: -100, y: -100, z: -100 },
                        max: { x: 100, y: 100, z: 100 },
                    };
                    camera.zoomToFit(bounds.min, bounds.max, 500);
                }

                // Toggle first-person mode
                if (e.key === 'c' || e.key === 'C') {
                    firstPersonModeRef.current = !firstPersonModeRef.current;
                    camera.enableFirstPersonMode(firstPersonModeRef.current);
                    console.log('[Viewport] First-person mode:', firstPersonModeRef.current ? 'enabled' : 'disabled');
                }
            };

            const handleKeyUp = (e: KeyboardEvent) => {
                keyState[e.key.toLowerCase()] = false;
            };

            // Store handlers in ref for cleanup
            keyboardHandlersRef.current.handleKeyDown = handleKeyDown;
            keyboardHandlersRef.current.handleKeyUp = handleKeyUp;

            // Continuous keyboard movement
            const keyboardMove = () => {
                if (aborted) return;

                let moved = false;
                const panSpeed = 5;
                const zoomSpeed = 0.1;

                if (firstPersonModeRef.current) {
                    // First-person movement
                    if (keyState['w'] || keyState['arrowup']) {
                        camera.moveFirstPerson(1, 0, 0);
                        moved = true;
                    }
                    if (keyState['s'] || keyState['arrowdown']) {
                        camera.moveFirstPerson(-1, 0, 0);
                        moved = true;
                    }
                    if (keyState['a'] || keyState['arrowleft']) {
                        camera.moveFirstPerson(0, -1, 0);
                        moved = true;
                    }
                    if (keyState['d'] || keyState['arrowright']) {
                        camera.moveFirstPerson(0, 1, 0);
                        moved = true;
                    }
                    if (keyState['q']) {
                        camera.moveFirstPerson(0, 0, -1);
                        moved = true;
                    }
                    if (keyState['e']) {
                        camera.moveFirstPerson(0, 0, 1);
                        moved = true;
                    }
                } else {
                    // Orbit mode movement
                    if (keyState['w'] || keyState['arrowup']) {
                        camera.pan(0, panSpeed, false);
                        moved = true;
                    }
                    if (keyState['s'] || keyState['arrowdown']) {
                        camera.pan(0, -panSpeed, false);
                        moved = true;
                    }
                    if (keyState['a'] || keyState['arrowleft']) {
                        camera.pan(-panSpeed, 0, false);
                        moved = true;
                    }
                    if (keyState['d'] || keyState['arrowright']) {
                        camera.pan(panSpeed, 0, false);
                        moved = true;
                    }
                    if (keyState['q']) {
                        camera.zoom(-zoomSpeed * 100, false);
                        moved = true;
                    }
                    if (keyState['e']) {
                        camera.zoom(zoomSpeed * 100, false);
                        moved = true;
                    }
                }

                if (moved) {
                    renderer.render();
                }

                requestAnimationFrame(keyboardMove);
            };

            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
            keyboardMove();

            // Handle resize
            resizeObserver = new ResizeObserver(() => {
                if (aborted) return;
                const rect = canvas.getBoundingClientRect();
                const width = Math.max(1, Math.floor(rect.width));
                const height = Math.max(1, Math.floor(rect.height));
                renderer.resize(width, height);
                renderer.render();
            });
            resizeObserver.observe(canvas);

            renderer.render();
        });

        return () => {
            aborted = true;
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            if (keyboardHandlersRef.current.handleKeyDown) {
                window.removeEventListener('keydown', keyboardHandlersRef.current.handleKeyDown);
            }
            if (keyboardHandlersRef.current.handleKeyUp) {
                window.removeEventListener('keyup', keyboardHandlersRef.current.handleKeyUp);
            }
            setIsInitialized(false);
            rendererRef.current = null;
        };
    }, [setSelectedEntityId]);

    // Track processed meshes for incremental updates
    const processedMeshIdsRef = useRef<Set<number>>(new Set());
    const lastGeometryLengthRef = useRef<number>(0);
    const lastGeometryRef = useRef<MeshData[] | null>(null);
    const cameraFittedRef = useRef<boolean>(false);

    useEffect(() => {
        const renderer = rendererRef.current;

        console.log('[Viewport] Geometry effect:', {
            hasRenderer: !!renderer,
            hasGeometry: !!geometry,
            isInitialized,
            geometryLength: geometry?.length,
            lastLength: lastGeometryLengthRef.current
        });

        if (!renderer || !geometry || !isInitialized) return;

        // Use the safe getGPUDevice() method that returns null if not ready
        const device = renderer.getGPUDevice();
        if (!device) {
            console.warn('[Viewport] Device not ready, skipping geometry processing');
            return;
        }

        const scene = renderer.getScene();
        const currentLength = geometry.length;
        const lastLength = lastGeometryLengthRef.current;
        const isIncremental = currentLength > lastLength;
        
        // Check if geometry array reference changed (filtering scenario)
        const geometryChanged = lastGeometryRef.current !== geometry;
        const lastGeometry = lastGeometryRef.current;

        console.log(`[Viewport] Geometry update check: current=${currentLength}, last=${lastLength}, incremental=${isIncremental}, geometryChanged=${geometryChanged}`);

        // If geometry array reference changed, we need to rebuild (filtering scenario)
        if (geometryChanged && lastGeometry !== null) {
            console.log('[Viewport] Geometry array reference changed (filtering), clearing and rebuilding');
            scene.clear();
            processedMeshIdsRef.current.clear();
            lastGeometryLengthRef.current = 0;
            lastGeometryRef.current = geometry;
        } else if (isIncremental) {
            // Incremental update: only add new meshes
            console.log(`[Viewport] Incremental update: adding ${currentLength - lastLength} new meshes (total: ${currentLength})`);
            lastGeometryRef.current = geometry;
        } else if (currentLength === 0) {
            // Clear scene if geometry was cleared
            scene.clear();
            processedMeshIdsRef.current.clear();
            cameraFittedRef.current = false;
            lastGeometryLengthRef.current = 0;
            lastGeometryRef.current = null;
            return;
        } else if (currentLength === lastGeometryLengthRef.current && !geometryChanged) {
            // Same length and same reference - might be a re-render, skip if already processed
            return;
        } else {
            // Length decreased or changed - this means a new file was loaded or filter changed, clear and rebuild from scratch
            console.log('[Viewport] Geometry length changed, clearing and rebuilding from scratch');
            scene.clear();
            processedMeshIdsRef.current.clear();
            cameraFittedRef.current = false;
            lastGeometryLengthRef.current = 0; // Reset so we process all new meshes
            lastGeometryRef.current = geometry;
        }
        
        // Ensure lastGeometryRef is set if it wasn't set above
        if (lastGeometryRef.current === null) {
            lastGeometryRef.current = geometry;
        }

        // Process only new meshes (for incremental updates)
        // If we cleared the scene (filtering or length change), process all meshes
        const startIndex = lastGeometryLengthRef.current;
        const meshesToAdd = geometry.slice(startIndex);

        console.log(`[Viewport] Processing ${meshesToAdd.length} meshes (starting at index ${startIndex})`);

        // Create GPU buffers for new meshes only
        // Note: Coordinates have already been shifted to origin by CoordinateHandler
        // if large coordinates were detected. Use shifted bounds from coordinateInfo.
        for (const meshData of meshesToAdd) {
            // Skip if already processed (safety check)
            // This check is important for incremental updates, but if we cleared the scene,
            // processedMeshIdsRef will be empty, so all meshes will be processed
            if (processedMeshIdsRef.current.has(meshData.expressId)) {
                continue;
            }

            // Build interleaved buffer
            const vertexCount = meshData.positions.length / 3;
            const interleaved = new Float32Array(vertexCount * 6);
            for (let i = 0; i < vertexCount; i++) {
                const base = i * 6;
                const posBase = i * 3;
                const normBase = i * 3;
                interleaved[base] = meshData.positions[posBase];
                interleaved[base + 1] = meshData.positions[posBase + 1];
                interleaved[base + 2] = meshData.positions[posBase + 2];
                interleaved[base + 3] = meshData.normals[normBase];
                interleaved[base + 4] = meshData.normals[normBase + 1];
                interleaved[base + 5] = meshData.normals[normBase + 2];
            }

            const vertexBuffer = device.createBuffer({
                size: interleaved.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(vertexBuffer, 0, interleaved);

            const indexBuffer = device.createBuffer({
                size: meshData.indices.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(indexBuffer, 0, meshData.indices);

            scene.addMesh({
                expressId: meshData.expressId,
                vertexBuffer,
                indexBuffer,
                indexCount: meshData.indices.length,
                transform: MathUtils.identity(),
                color: meshData.color,
            });

            processedMeshIdsRef.current.add(meshData.expressId);
        }

        // Update last length
        lastGeometryLengthRef.current = currentLength;

        console.log('[Viewport] Meshes added:', scene.getMeshes().length);

        // Fit camera only once (on first batch or when we have coordinate info)
        // For incremental updates, fit camera when we get valid bounds
        if (!cameraFittedRef.current && coordinateInfo && coordinateInfo.shiftedBounds) {
            const shiftedBounds = coordinateInfo.shiftedBounds;
            const size = {
                x: shiftedBounds.max.x - shiftedBounds.min.x,
                y: shiftedBounds.max.y - shiftedBounds.min.y,
                z: shiftedBounds.max.z - shiftedBounds.min.z,
            };
            const maxSize = Math.max(size.x, size.y, size.z);

            // Only fit camera if bounds are valid (non-zero size)
            if (maxSize > 0 && Number.isFinite(maxSize)) {
                console.log('[Viewport] Fitting camera to bounds:', {
                    shiftedBounds,
                    size,
                    maxSize,
                    isGeoReferenced: coordinateInfo.isGeoReferenced,
                    originShift: coordinateInfo.originShift,
                });
                renderer.getCamera().fitToBounds(shiftedBounds.min, shiftedBounds.max);
                cameraFittedRef.current = true;
            } else {
                console.warn('[Viewport] Invalid bounds, skipping camera fit:', { shiftedBounds, maxSize });
            }
        } else if (!cameraFittedRef.current && geometry.length > 0) {
            // Fallback: calculate bounds from current geometry if no coordinate info yet
            console.log('[Viewport] Calculating bounds from current geometry');
            const fallbackBounds = {
                min: { x: Infinity, y: Infinity, z: Infinity },
                max: { x: -Infinity, y: -Infinity, z: -Infinity },
            };

            for (const meshData of geometry) {
                const positions = meshData.positions;
                for (let i = 0; i < positions.length; i += 3) {
                    const x = positions[i];
                    const y = positions[i + 1];
                    const z = positions[i + 2];
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                        fallbackBounds.min.x = Math.min(fallbackBounds.min.x, x);
                        fallbackBounds.min.y = Math.min(fallbackBounds.min.y, y);
                        fallbackBounds.min.z = Math.min(fallbackBounds.min.z, z);
                        fallbackBounds.max.x = Math.max(fallbackBounds.max.x, x);
                        fallbackBounds.max.y = Math.max(fallbackBounds.max.y, y);
                        fallbackBounds.max.z = Math.max(fallbackBounds.max.z, z);
                    }
                }
            }

            const hasValidBounds =
                fallbackBounds.min.x !== Infinity && fallbackBounds.max.x !== -Infinity &&
                fallbackBounds.min.y !== Infinity && fallbackBounds.max.y !== -Infinity &&
                fallbackBounds.min.z !== Infinity && fallbackBounds.max.z !== -Infinity;

            if (hasValidBounds) {
                renderer.getCamera().fitToBounds(fallbackBounds.min, fallbackBounds.max);
                cameraFittedRef.current = true;
            }
        } else if (!cameraFittedRef.current) {
            // Fallback: calculate bounds from positions (shouldn't happen if coordinate handler worked)
            console.warn('[Viewport] No coordinateInfo, calculating bounds from positions');
            const fallbackBounds = {
                min: { x: Infinity, y: Infinity, z: Infinity },
                max: { x: -Infinity, y: -Infinity, z: -Infinity },
            };

            for (const meshData of geometry) {
                const positions = meshData.positions;
                for (let i = 0; i < positions.length; i += 3) {
                    const x = positions[i];
                    const y = positions[i + 1];
                    const z = positions[i + 2];
                    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                        fallbackBounds.min.x = Math.min(fallbackBounds.min.x, x);
                        fallbackBounds.min.y = Math.min(fallbackBounds.min.y, y);
                        fallbackBounds.min.z = Math.min(fallbackBounds.min.z, z);
                        fallbackBounds.max.x = Math.max(fallbackBounds.max.x, x);
                        fallbackBounds.max.y = Math.max(fallbackBounds.max.y, y);
                        fallbackBounds.max.z = Math.max(fallbackBounds.max.z, z);
                    }
                }
            }

            const hasValidBounds =
                fallbackBounds.min.x !== Infinity && fallbackBounds.max.x !== -Infinity &&
                fallbackBounds.min.y !== Infinity && fallbackBounds.max.y !== -Infinity &&
                fallbackBounds.min.z !== Infinity && fallbackBounds.max.z !== -Infinity;

            if (hasValidBounds) {
                const size = {
                    x: fallbackBounds.max.x - fallbackBounds.min.x,
                    y: fallbackBounds.max.y - fallbackBounds.min.y,
                    z: fallbackBounds.max.z - fallbackBounds.min.z,
                };
                const maxSize = Math.max(size.x, size.y, size.z);
                if (maxSize > 0) {
                    console.log('[Viewport] Fitting camera to calculated bounds:', { fallbackBounds, size, maxSize });
                    renderer.getCamera().fitToBounds(fallbackBounds.min, fallbackBounds.max);
                    cameraFittedRef.current = true;
                } else {
                    console.warn('[Viewport] Calculated bounds have zero size, trying scene bounds');
                    const sceneBounds = renderer.getScene().getBounds();
                    if (sceneBounds) {
                        const sceneSize = {
                            x: sceneBounds.max.x - sceneBounds.min.x,
                            y: sceneBounds.max.y - sceneBounds.min.y,
                            z: sceneBounds.max.z - sceneBounds.min.z,
                        };
                        const sceneMaxSize = Math.max(sceneSize.x, sceneSize.y, sceneSize.z);
                        if (sceneMaxSize > 0) {
                            console.log('[Viewport] Fitting camera to scene bounds:', { sceneBounds, sceneSize, sceneMaxSize });
                            renderer.getCamera().fitToBounds(sceneBounds.min, sceneBounds.max);
                            cameraFittedRef.current = true;
                        }
                    }
                }
            } else {
                console.warn('[Viewport] Invalid bounds, using scene bounds fallback');
                const sceneBounds = renderer.getScene().getBounds();
                if (sceneBounds) {
                    const sceneSize = {
                        x: sceneBounds.max.x - sceneBounds.min.x,
                        y: sceneBounds.max.y - sceneBounds.min.y,
                        z: sceneBounds.max.z - sceneBounds.min.z,
                    };
                    const sceneMaxSize = Math.max(sceneSize.x, sceneSize.y, sceneSize.z);
                    if (sceneMaxSize > 0) {
                        console.log('[Viewport] Fitting camera to scene bounds:', { sceneBounds, sceneSize, sceneMaxSize });
                        renderer.getCamera().fitToBounds(sceneBounds.min, sceneBounds.max);
                        cameraFittedRef.current = true;
                    }
                }
            }
        }
        renderer.render();
    }, [geometry, isInitialized]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: '100%',
                height: '100%',
                display: 'block',
            }}
        />
    );
}
