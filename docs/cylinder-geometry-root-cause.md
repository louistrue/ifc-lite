# Cylinder Geometry Root-Cause Analysis (work branch vs main baseline)

## Scope
This analysis focuses on cylindrical objects (e.g., `IfcPile`, swept disks, pipe segments) that looked glossy/faceted and visually less "solid" compared to BIMcollab.

## Primary root cause
The main geometry issue was **faceted side-wall normals on extruded circular profiles**.

- In the extrusion path, side-wall normals are generated in `create_side_walls`.
- The fixed implementation now computes **per-vertex radial normals from the profile centroid** and uses those normals on quad vertices, producing smooth cylinder shading.
- This replaces the faceted behavior where each side quad had an edge normal, creating strong vertical banding/specular stripes.

## Supporting factors
Two additional geometry quality factors amplified the artifact:

1. **Low tessellation density** for circular primitives made each facet larger and more visible.
   - Circle profiles were increased to 36 segments.
   - Swept disk solids were increased to 24 segments.

2. The renderer uses multi-light shading with rim contribution, which can visually exaggerate faceting when normals are hard/segmented.

## Why this matches BIMcollab comparison
BIMcollab cylinders appear smoother/denser in shading transitions (even if still polygonal). The branch fixes align with that look by smoothing normals and increasing segment counts.

## Files that contain the fix
- `rust/geometry/src/extrusion.rs` (smooth radial side normals in extrusion side walls)
- `rust/geometry/src/profiles.rs` (higher circle/ellipse segment counts)
- `rust/geometry/src/processors/swept.rs` (higher swept disk tube segments)

## Conclusion
The root issue was not whitelist logic; it was in mesh generation for cylinders: **hard side normals + coarse circular tessellation**. The branch changes directly target this and are the correct fix direction.
