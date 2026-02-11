---
"@ifc-lite/renderer": minor
"@ifc-lite/viewer": minor
---

Add orthographic projection, pinboard, lens, type tree, and floorplan views

### Renderer
- Orthographic reverse-Z projection matrix in math utilities
- Camera projection mode toggle (perspective/orthographic) with seamless switching
- Orthographic zoom scales view size instead of camera distance
- Parallel ray unprojection for orthographic picking

### Viewer
- **Orthographic projection**: Toggle button, unified Views dropdown, numpad `5` keyboard shortcut
- **Automatic Floorplan**: Per-storey section cuts with top-down ortho view, dropdown in toolbar
- **Pinboard**: Selection basket with Pin/Unpin/Show, entity isolation via serialized EntityRef Set
- **Tree View by Type**: IFC type grouping mode alongside spatial hierarchy, localStorage persistence
- **Lens**: Rule-based 3D colorization/filtering with built-in presets (By IFC Type, Structural Elements), full panel UI with color legend and rule evaluation engine
