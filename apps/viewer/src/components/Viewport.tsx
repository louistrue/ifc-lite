/**
 * 3D viewport component
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { Renderer } from '@ifc-lite/renderer';
import { MathUtils } from '@ifc-lite/renderer';
import type { MeshData } from '@ifc-lite/geometry';
import { useViewerStore } from '../store.js';

interface ViewportProps {
    geometry: MeshData[] | null;
}

export function Viewport({ geometry }: ViewportProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rendererRef = useRef<Renderer | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const selectedEntityId = useViewerStore((state) => state.selectedEntityId);
    const setSelectedEntityId = useViewerStore((state) => state.setSelectedEntityId);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Abort flag to prevent stale async operations from completing
        let aborted = false;
        let resizeObserver: ResizeObserver | null = null;

        // #region agent log
        const instanceId = Math.random().toString(36).slice(2, 8);
        fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Viewport.tsx:useEffect-init', message: 'Starting renderer init', data: { instanceId, hasExistingRenderer: !!rendererRef.current }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1-H5' }) }).catch(() => { });
        // #endregion

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
                // #region agent log
                fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Viewport.tsx:init-aborted', message: 'Init aborted (cleanup called)', data: { instanceId }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1-H5' }) }).catch(() => { });
                // #endregion
                return;
            }

            // #region agent log
            fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Viewport.tsx:init-complete', message: 'Renderer init complete', data: { instanceId, isInitialized: true }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H1' }) }).catch(() => { });
            // #endregion
            console.log('[Viewport] Renderer initialized');
            setIsInitialized(true);

            // Setup mouse controls
            let isDragging = false;
            let lastX = 0;
            let lastY = 0;

            canvas.addEventListener('mousedown', (e) => {
                isDragging = true;
                lastX = e.clientX;
                lastY = e.clientY;
            });

            canvas.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    const dx = e.clientX - lastX;
                    const dy = e.clientY - lastY;
                    renderer.getCamera().orbit(dx, dy);
                    lastX = e.clientX;
                    lastY = e.clientY;
                    renderer.render();
                }
            });

            canvas.addEventListener('mouseup', () => {
                isDragging = false;
            });

            canvas.addEventListener('wheel', (e) => {
                e.preventDefault();
                renderer.getCamera().zoom(e.deltaY);
                renderer.render();
            });

            canvas.addEventListener('click', async (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const pickedId = await renderer.pick(x, y);
                setSelectedEntityId(pickedId);
            });

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
            // #region agent log
            fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Viewport.tsx:cleanup', message: 'Cleanup called', data: { instanceId, hadRenderer: !!rendererRef.current }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H5' }) }).catch(() => { });
            // #endregion
            aborted = true;
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            setIsInitialized(false);
            rendererRef.current = null;
        };
    }, [setSelectedEntityId]);

    useEffect(() => {
        const renderer = rendererRef.current;
        console.log('[Viewport] Geometry effect:', {
            hasRenderer: !!renderer,
            hasGeometry: !!geometry,
            isInitialized,
            geometryLength: geometry?.length
        });

        if (!renderer || !geometry || !isInitialized) return;

        const device = (renderer as any).device.getDevice();
        if (!device) return;

        console.log('[Viewport] Processing geometry:', geometry.length, 'meshes');
        const scene = renderer.getScene();
        scene.clear();

        // Calculate bounds from mesh data
        const bounds = {
            min: { x: Infinity, y: Infinity, z: Infinity },
            max: { x: -Infinity, y: -Infinity, z: -Infinity },
        };

        // #region agent log
        if (geometry.length > 0) {
            const first = geometry[0];
            fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Viewport.tsx:positions-debug', message: 'First mesh positions', data: { positionsType: first.positions?.constructor?.name, positionsLength: first.positions?.length, firstValues: first.positions ? Array.from(first.positions.slice(0, 12)) : [], byteLength: first.positions?.byteLength, isTypedArray: first.positions instanceof Float32Array }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H4-detail' }) }).catch(() => { });
        }
        // #endregion

        // Create GPU buffers for each mesh
        // Max reasonable IFC coordinate - based on valid Y range of ~125 units
        // Using 500 as threshold to filter garbage while keeping valid coordinates
        const MAX_COORD = 500;
        const isValidCoord = (v: number) => Number.isFinite(v) && Math.abs(v) < MAX_COORD;

        for (const meshData of geometry) {
            // Update bounds from positions (skip invalid/extreme values)
            for (let i = 0; i < meshData.positions.length; i += 3) {
                const x = meshData.positions[i];
                const y = meshData.positions[i + 1];
                const z = meshData.positions[i + 2];
                // Only update bounds with valid values (finite and within reasonable range)
                if (isValidCoord(x)) {
                    bounds.min.x = Math.min(bounds.min.x, x);
                    bounds.max.x = Math.max(bounds.max.x, x);
                }
                if (isValidCoord(y)) {
                    bounds.min.y = Math.min(bounds.min.y, y);
                    bounds.max.y = Math.max(bounds.max.y, y);
                }
                if (isValidCoord(z)) {
                    bounds.min.z = Math.min(bounds.min.z, z);
                    bounds.max.z = Math.max(bounds.max.z, z);
                }
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
        }

        console.log('[Viewport] Bounds:', bounds);
        console.log('[Viewport] Meshes added:', scene.getMeshes().length);

        // #region agent log
        fetch('http://127.0.0.1:7248/ingest/23432d39-3a37-4dd4-80fc-bbd61504cb4e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'Viewport.tsx:before-fitToBounds', message: 'About to fit bounds', data: { minX: bounds.min.x, minY: bounds.min.y, minZ: bounds.min.z, maxX: bounds.max.x, maxY: bounds.max.y, maxZ: bounds.max.z, meshCount: scene.getMeshes().length }, timestamp: Date.now(), sessionId: 'debug-session', hypothesisId: 'H4' }) }).catch(() => { });
        // #endregion

        // Fit camera to calculated bounds (only if we have valid finite bounds)
        const hasValidBounds =
            Number.isFinite(bounds.min.x) && Number.isFinite(bounds.max.x) &&
            Number.isFinite(bounds.min.y) && Number.isFinite(bounds.max.y) &&
            Number.isFinite(bounds.min.z) && Number.isFinite(bounds.max.z);

        if (hasValidBounds) {
            renderer.getCamera().fitToBounds(bounds.min, bounds.max);
        } else {
            console.warn('[Viewport] Invalid bounds, using default camera position');
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
