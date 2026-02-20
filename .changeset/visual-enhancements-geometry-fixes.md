---
"@ifc-lite/renderer": minor
"@ifc-lite/data": minor
"@ifc-lite/parser": minor
"@ifc-lite/wasm": minor
---

Add visual enhancement post-processing (contact shading, separation lines, edge contrast) and fix geometry parsing / entity type resolution

**Renderer — visual enhancements:**
- Add fullscreen post-processing pass (`PostProcessor`) with depth-based contact shading and object-ID-based separation lines for improved visual clarity between adjacent elements
- Add configurable edge contrast enhancement via shader uniforms with adjustable intensity
- New `VisualEnhancementOptions` API with independent quality presets (`off` / `low` / `high`), intensity, and radius for contact shading, separation lines, and edge contrast
- Automatically disable expensive effects on mobile devices

**Renderer — render pipeline changes:**
- Add second render target (`rgba8unorm` object ID texture) to all render pipelines (opaque, transparent, overlay, instanced) for per-entity boundary detection
- Expand vertex format from 6 to 7 floats (position + normal + entityId) across all pipelines and the picker
- Encode entity IDs into the object ID texture via 24-bit RGB encoding in fragment shaders
- Depth texture now created with `TEXTURE_BINDING` usage for post-processor sampling
- Edge contrast rendering made conditional via uniform flags (`flags.z` / `flags.w`) instead of always-on

**Renderer — geometry & scene:**
- `GeometryManager` interleaves entity ID into the 7th float of each vertex buffer
- `Scene` batching writes entity IDs per-vertex into merged buffers for instanced rendering

**Data — entity type system expansion:**
- Add ~30 new `IfcTypeEnum` entries: chimney, shading device, building element part, element assembly, reinforcing bar/mesh/tendon, discrete accessory, mechanical fastener, flow controller/moving device/storage device/treatment device/energy conversion device, duct/pipe/cable segments, furniture, proxy, annotation, transport element, civil element, geographic element
- Add ~11 new type definition enums: pile type, member type, plate type, footing type, covering type, railing type, stair type, ramp type, roof type, curtain wall type, building element proxy type
- Map `*StandardCase` variants (e.g. `IFCSLABSTANDARDCASE`, `IFCCOLUMNSTANDARDCASE`) to their base enum values for correct grouping
- Expand `TYPE_STRING_TO_ENUM` and `TYPE_ENUM_TO_STRING` maps with all new types
- Add new `ifc-entity-names.ts` with 888-line UPPERCASE → PascalCase lookup table (all IFC4X3 entity names) for correct display of any IFC entity type
- Add `rawTypeName` field to `EntityTableBuilder` storing normalized type name as string index
- `getTypeName()` now falls back to `rawTypeName` for types not in the enum, eliminating "Unknown" display for valid IFC types

**Parser:**
- Add diagnostic `console.debug` logging for spatial entity extraction and `console.warn` on extraction failures

**WASM / Rust geometry engine:**
- Replace overly broad geometry entity filter (`starts_with("IFC") && !ends_with("TYPE") && ...`) with explicit whitelist of ~120 IfcProduct subtypes in `has_geometry_by_name`, preventing non-product entities (e.g. `IfcDimensionalExponents`, `IfcSurfaceStyleRendering`) from being sent to geometry processing
- Add `SolidModel` to the accepted representation types in the geometry router (6 match arms)
- Use smooth per-vertex normals for extruded circular profiles (cylinder side walls) with `is_approximately_circular_profile` heuristic that detects circular vs polygonal profiles by coefficient of variation of radii from centroid
- Increase circle tessellation from 24 to 36 segments for profiles (circle, circle hollow, trimmed curve, ellipse)
- Increase swept disk solid tube segments from 12 to 24 for smoother pipes
- Fix `PolygonalFaceSet` processing: generate flat-shaded meshes with per-face normals via `build_flat_shaded_mesh` and fix closed-shell winding orientation via `orient_closed_shell_outward`
- Improve geometry extraction statistics: separate "no representation" (expected) from actual processing failures in diagnostic logging
- Add `console.debug` logging for entities skipped due to missing representation

**Viewer app:**
- Add visual enhancement state to Zustand UI slice with 10 configurable properties (enabled, edge contrast enabled/intensity, contact shading quality/intensity/radius, separation lines enabled/quality/intensity/radius)
- Wire `VisualEnhancementOptions` through `Viewport`, `useAnimationLoop`, and `useRenderUpdates` via memoized ref pattern
- Show IFC type name instead of "Unknown" for spatial entities with generic names in the tree hierarchy
- Expand `useThemeState` hook with all visual enhancement selectors
