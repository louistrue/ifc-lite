---
"@ifc-lite/bcf": minor
"@ifc-lite/renderer": patch
"@ifc-lite/viewer": minor
---

feat: Add BCF (BIM Collaboration Format) support

Adds full BCF 2.1 support for issue tracking and collaboration in BIM workflows:

**BCF Package (@ifc-lite/bcf):**
- Read/write BCF 2.1 .bcfzip files
- Full viewpoint support with camera position, components, and clipping planes
- Coordinate system conversion between Y-up (viewer) and Z-up (IFC/BCF)
- Support for multiple snapshot naming conventions
- IFC GlobalId mapping for component references

**Viewer Integration:**
- BCF Issues panel with topic management
- Viewpoint capture with camera state and snapshot
- Viewpoint activation with smooth camera animation
- Import/export BCF files compatible with BIMcollab and other tools

**Renderer Fixes:**
- Fix screenshot distortion caused by WebGPU texture row alignment
- Add GPU-synchronized screenshot capture for accurate snapshots
