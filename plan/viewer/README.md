# IFC-Lite Viewer: Showcase Application

## A High-Performance WebGPU Viewer for Massive IFC Models

**Version:** 1.0.0  
**Author:** Louis / Ltplus AG  
**Date:** January 2026  
**Status:** Technical Specification

---

## Vision

> "Load a 500MB IFC file, see first geometry in 2 seconds, navigate smoothly through millions of objects, and query any element instantly."

---

## Document Index

| Part | Title | Description |
|------|-------|-------------|
| [01](01-overview-architecture.md) | Overview & Architecture | Vision, targets, system design |
| [02](02-rendering-pipeline.md) | Rendering Pipeline | WebGPU, LOD, culling, instancing |
| [03](03-data-management.md) | Data Management | Streaming, memory, caching |
| [04](04-user-interface.md) | User Interface | Navigation, selection, tools |
| [05](05-implementation-plan.md) | Implementation Plan | Timeline, resources, milestones |

---

## Key Performance Targets

| Metric | Typical Web Viewer | IFC-Lite Viewer |
|--------|-------------------|-----------------|
| Max model size | 50-100MB | **1GB+** |
| Max triangles | 1-5M | **50M+** |
| First paint | 10-30s | **<2s** |
| Navigation FPS | 15-30 | **60 stable** |
| Memory (100MB IFC) | 2-4GB | **<800MB** |
| Mobile support | Limited | **Full** |

---

## Key Innovations

1. **Progressive Streaming** — First geometry in <2s, priority queue by screen size
2. **Hierarchical Instancing** — 50-80% memory reduction, GPU instance culling
3. **Hybrid LOD System** — Screen-space error, mesh simplification, smooth transitions
4. **GPU-Driven Rendering** — WebGPU compute culling, indirect draws, single-pass picking
5. **Smart Memory** — Out-of-core streaming, LRU eviction, IndexedDB caching

---

## Recommendation

**Proceed with development as Phase 2 of IFC-Lite platform.**

Delivers complete end-to-end solution demonstrating fastest browser-native IFC viewing capability.

---

*For detailed specifications, see the individual document parts.*
