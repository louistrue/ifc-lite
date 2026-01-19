---
"@ifc-lite/renderer": patch
---

Add magnetic edge snapping to measure tool.
- New raycastSceneMagnetic API for edge-aware snapping
- Edge lock state management for "stick and slide" behavior
- Corner detection with valence tracking
- Smooth snapping transitions along edges
