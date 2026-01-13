# IFC-Lite Georeferencing & Large Coordinate Handling

## Overview

This document outlines the strategy for supporting georeferencing and handling large coordinates with floating-point precision in IFC-Lite. The goal is to correctly handle global coordinates while maintaining performance for rendering.

## Current Implementation Status

IFC-Lite already has solid foundations for georeferencing:

### TypeScript Parser (`packages/parser/src/georef-extractor.ts`)
- Extracts `IfcMapConversion` and `IfcProjectedCRS` from IFC4 models
- Computes 4x4 transformation matrices (Helmert transformation)
- Provides `transformToWorld()` and `transformToLocal()` functions

### Coordinate Handler (`packages/geometry/src/coordinate-handler.ts`)
- Implements RTC (Relative-To-Center) approach
- Automatically detects large coordinates (>10km threshold)
- Shifts mesh positions to centroid for f32 precision
- Filters corrupted coordinate values
- Supports incremental/streaming processing

### Rust Geometry Engine (`rust/geometry/src/`)
- Uses `f64` (double precision) for all internal geometry calculations
- Converts to `f32` only at final mesh output stage
- Triangulation, extrusion, CSG all use f64 precision

## Problem Statement

### 1. Large Coordinates in Infrastructure/GIS
IFC models used in infrastructure projects often use real-world coordinates (UTM, State Plane, etc.) with values like:
- Eastings: 500,000+ meters
- Northings: 5,000,000+ meters

### 2. Floating-Point Precision Issues

| Data Type | Bits | Precision Near Origin | Precision at Large Coords (10^7m) |
|-----------|------|----------------------|----------------------------------|
| f32 | 32 | ~0.00001m | ~1-2 meters |
| f64 | 64 | ~10^-15m | ~0.000003m (3.16nm) |

**Key insight**: Using f32 for UTM coordinates loses meter-level precision, causing:
- Visual jittering in rendering
- Triangle z-fighting
- Incorrect boolean operations
- Model federation failures

### 3. GPU Rendering Constraints
- WebGL/WebGPU use f32 for vertex positions
- GPU native f64 is 1/32 to 1/64 slower than f32
- Large coordinate values cause precision loss in shaders

## IFC Schema Support

### IFC4 Georeferencing Entities

```
IfcProject
  └─ IfcGeometricRepresentationContext
       └─ HasCoordinateOperation
            └─ IfcMapConversion
                 ├─ Eastings (f64)
                 ├─ Northings (f64)
                 ├─ OrthogonalHeight (f64)
                 ├─ XAxisAbscissa (f64)
                 ├─ XAxisOrdinate (f64)
                 ├─ Scale (f64, default=1.0)
                 └─ TargetCRS
                      └─ IfcProjectedCRS
                           ├─ Name (e.g., "EPSG:32632")
                           ├─ GeodeticDatum
                           ├─ VerticalDatum
                           └─ MapUnit
```

### IFC2X3 Compatibility
Uses property sets on IfcSite:
- `ePSet_MapConversion`
- `ePSet_ProjectedCRS`

### IfcMapConversion Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| SourceCRS | IfcGeometricRepresentationContext | Local coordinate system |
| TargetCRS | IfcProjectedCRS | Target CRS (e.g., UTM Zone 32N) |
| Eastings | IfcLengthMeasure | X translation to target CRS |
| Northings | IfcLengthMeasure | Y translation to target CRS |
| OrthogonalHeight | IfcLengthMeasure | Z translation to target CRS |
| XAxisAbscissa | IfcReal | cos(rotation angle) |
| XAxisOrdinate | IfcReal | sin(rotation angle) |
| Scale | IfcReal | Scale factor (default 1.0) |

### Coordinate Transformation Formula

The Helmert transformation from local to map coordinates:

```
Rotation angle θ = atan2(XAxisOrdinate, XAxisAbscissa)

| E |   | Scale * cos(θ)  -Scale * sin(θ)   0 | | x |   | Eastings        |
| N | = | Scale * sin(θ)   Scale * cos(θ)   0 | | y | + | Northings       |
| H |   | 0                0                1 | | z |   | OrthogonalHeight|
```

## Proposed Architecture

### Dual-Coordinate Strategy

IFC-Lite will maintain two coordinate representations:

```rust
/// Georeferencing information extracted from IFC
#[derive(Debug, Clone)]
pub struct GeoReference {
    /// EPSG code (e.g., "EPSG:32632")
    pub crs_name: Option<String>,
    /// Translation (Eastings, Northings, Height)
    pub origin: (f64, f64, f64),
    /// Rotation angle in radians
    pub rotation: f64,
    /// Scale factor
    pub scale: f64,
}

impl GeoReference {
    /// Transform local coordinates to map coordinates
    #[inline]
    pub fn local_to_map(&self, local: (f64, f64, f64)) -> (f64, f64, f64) {
        let (x, y, z) = local;
        let cos_r = self.rotation.cos();
        let sin_r = self.rotation.sin();
        let s = self.scale;

        let e = s * (cos_r * x - sin_r * y) + self.origin.0;
        let n = s * (sin_r * x + cos_r * y) + self.origin.1;
        let h = z + self.origin.2;

        (e, n, h)
    }

    /// Transform map coordinates to local coordinates
    #[inline]
    pub fn map_to_local(&self, map: (f64, f64, f64)) -> (f64, f64, f64) {
        let (e, n, h) = map;
        let cos_r = self.rotation.cos();
        let sin_r = self.rotation.sin();
        let s = self.scale;

        let dx = e - self.origin.0;
        let dy = n - self.origin.1;

        let x = (cos_r * dx + sin_r * dy) / s;
        let y = (-sin_r * dx + cos_r * dy) / s;
        let z = h - self.origin.2;

        (x, y, z)
    }
}
```

### Mesh Representation

```rust
/// Mesh with optional georeferencing
pub struct GeoMesh {
    /// Local coordinates (relative to model origin) - for rendering
    /// Stored as f32 for GPU efficiency
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,

    /// Georeferencing info (optional)
    pub geo_reference: Option<GeoReference>,
}
```

### Processing Pipeline

```
IFC File
    │
    ▼
┌─────────────────────────────────────────┐
│ 1. Parse Georeferencing                 │
│    - Extract IfcMapConversion           │
│    - Extract IfcProjectedCRS            │
│    - Store as GeoReference              │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ 2. Process Geometry (f64 internally)    │
│    - Parse coordinates as f64           │
│    - Apply local placements (f64 math)  │
│    - Boolean operations (f64 precision) │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ 3. Output Options                       │
│                                         │
│  A. Rendering (f32 local coords)        │
│     - Convert to f32 for GPU            │
│     - Use RTC offset for large models   │
│                                         │
│  B. GIS Export (f64 map coords)         │
│     - Apply Helmert transformation      │
│     - Output full precision             │
│                                         │
│  C. Analysis (f64 local coords)         │
│     - Full precision calculations       │
│     - Measurements, quantities          │
└─────────────────────────────────────────┘
```

### Rendering Strategy: Relative-To-Center (RTC)

For large-coordinate models, use RTC to maintain precision with f32:

```rust
/// Compute RTC offset for a mesh
pub fn compute_rtc_offset(positions: &[f64]) -> (f64, f64, f64) {
    if positions.is_empty() {
        return (0.0, 0.0, 0.0);
    }

    // Use centroid as RTC offset
    let count = positions.len() / 3;
    let mut sum = (0.0f64, 0.0f64, 0.0f64);

    for chunk in positions.chunks_exact(3) {
        sum.0 += chunk[0];
        sum.1 += chunk[1];
        sum.2 += chunk[2];
    }

    (
        sum.0 / count as f64,
        sum.1 / count as f64,
        sum.2 / count as f64,
    )
}

/// Convert f64 positions to f32 with RTC offset
pub fn positions_to_f32_rtc(
    positions: &[f64],
    rtc_offset: (f64, f64, f64),
) -> Vec<f32> {
    positions
        .chunks_exact(3)
        .flat_map(|chunk| {
            [
                (chunk[0] - rtc_offset.0) as f32,
                (chunk[1] - rtc_offset.1) as f32,
                (chunk[2] - rtc_offset.2) as f32,
            ]
        })
        .collect()
}
```

### Multi-Tile Strategy for Very Large Models

For city-scale models or infrastructure:

```rust
/// Tile-based mesh storage for large models
pub struct TiledMesh {
    /// Tile size in meters
    pub tile_size: f64,
    /// Tiles indexed by (tile_x, tile_y)
    pub tiles: HashMap<(i32, i32), TileMesh>,
    /// Global georeferencing
    pub geo_reference: Option<GeoReference>,
}

pub struct TileMesh {
    /// Tile center (RTC offset)
    pub center: (f64, f64, f64),
    /// Positions relative to tile center (f32)
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub indices: Vec<u32>,
}
```

## Remaining Implementation Tasks

### Gap Analysis

| Component | Status | Notes |
|-----------|--------|-------|
| IfcMapConversion parsing (TS) | Done | `georef-extractor.ts` |
| IfcProjectedCRS parsing (TS) | Done | `georef-extractor.ts` |
| Coordinate shifting (TS) | Done | `coordinate-handler.ts` |
| f64 internal geometry (Rust) | Done | All processors use f64 |
| f32 mesh output (Rust) | Done | `mesh.rs` |
| WASM georef API | **TODO** | Expose to JS |
| Rust georef parsing | **TODO** | For pure-Rust pipeline |
| IFC2X3 ePSet support | **TODO** | Property set fallback |
| RTC offset in WASM | **TODO** | Return shift with mesh |

### What's Missing

1. **WASM API for Georeferencing**
   - The Rust WASM bindings don't expose georeferencing info
   - The coordinate handler is JS-only, not integrated with WASM

2. **End-to-End Integration**
   - TypeScript parser extracts georef
   - Rust generates geometry
   - Need to connect these in the processing pipeline

3. **Pure-Rust Georeferencing**
   - For native applications, need Rust-side parsing
   - Currently only TypeScript can extract IfcMapConversion

## Implementation Plan

### Phase 1: Core Georeferencing Support

1. **Add GeoReference struct** to `rust/core/src/`
2. **Parse IfcMapConversion** from IFC4 models
3. **Parse ePSet_MapConversion** from IFC2X3 models
4. **Expose via WASM API**:
   ```typescript
   interface GeoReference {
     crsName: string | null;
     eastings: number;
     northings: number;
     orthogonalHeight: number;
     rotation: number;
     scale: number;
   }

   // API
   getGeoReference(): GeoReference | null;
   localToMap(x: number, y: number, z: number): [number, number, number];
   mapToLocal(e: number, n: number, h: number): [number, number, number];
   ```

### Phase 2: Precision Improvements

1. **Use f64 internally** for all coordinate processing
2. **Keep f32 output** for rendering (with RTC)
3. **Add f64 output option** for GIS export

```rust
// Mesh output options
pub enum MeshPrecision {
    /// f32 positions with RTC offset (for rendering)
    RenderingF32 { rtc_offset: (f64, f64, f64) },
    /// f64 positions (for GIS/analysis)
    FullPrecisionF64,
}
```

### Phase 3: API Extensions

1. **Coordinate transformation API**
2. **Bounding box in map coordinates**
3. **Model federation support** (align multiple models)

## Performance Considerations

### Internal Processing (f64)
- Modern CPUs handle f64 nearly as fast as f32
- SIMD (AVX) works with f64 (4-wide vs 8-wide for f32)
- Memory bandwidth is the bottleneck, not arithmetic

### Output (f32 with RTC)
- GPU rendering requires f32
- RTC keeps values small, preserving precision
- No visual artifacts even for UTM coordinates

### Benchmarks to Run
1. Processing time: f64 vs f32 geometry operations
2. Memory usage: f64 vs f32 mesh storage
3. Rendering precision: RTC vs direct large coords

## References

- [IfcOpenShell Georeferencing API](https://docs.ifcopenshell.org/autoapi/ifcopenshell/api/georeference/index.html)
- [IfcOpenShell Geolocation Utilities](https://docs.ifcopenshell.org/autoapi/ifcopenshell/util/geolocation/index.html)
- [georeference-ifc Library](https://github.com/stijngoedertier/georeference-ifc)
- [How to Georeference a BIM Model](https://medium.com/@stijngoedertier/how-to-georeference-a-bim-model-1905d5154cfd)
- [IFC Coordinate Reference Systems and Revit](https://thinkmoult.com/ifc-coordinate-reference-systems-and-revit.html)
- [Level of Georeferencing (LoGeoRef) for BIM](https://jgcc.geoprevi.ro/docs/2019/10/jgcc_2019_no10_3.pdf)
- [Working with Large Coordinates in AutoCAD](https://blogs.autodesk.com/autocad/working-large-coordinates-in-autocad/)
- [Double-Precision Floating-Point Visualizations](https://arxiv.org/html/2408.09699v1)
- [CloudCompare 64-bit Coordinate Support](https://github.com/CloudCompare/CloudCompare/issues/638)
