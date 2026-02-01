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
- BCF panel integrated into properties panel area (resizable, same layout)
- Topic management with filtering and status updates
- Viewpoint capture with camera state, selection, and snapshot
- Viewpoint activation with smooth camera animation and visibility state
- Import/export BCF files compatible with BIMcollab and other tools
- Email setup nudge in empty state for easy author configuration
- Smart filename generation using model name for downloads

**Renderer Fixes:**
- Fix screenshot distortion caused by WebGPU texture row alignment
- Add GPU-synchronized screenshot capture for accurate snapshots

**Bug Fixes:**
- Fix BCF viewpoint visibility not clearing isolation mode
- Add localStorage error handling for private browsing mode
