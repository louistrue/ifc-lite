---
"@ifc-lite/renderer": patch
"@ifc-lite/spatial": patch
---

fix: eliminate facade flickering during orbit and zoom

- Restore object-ID pass and post-processing during camera interaction (reverts interaction skip that caused visual pop-in)
- Add PLANE_EPSILON margin to frustum culling plane checks to prevent floating-point jitter from toggling batch visibility at frustum boundaries
- Skip fresnel glass effects on selected objects so blue highlight renders correctly instead of appearing white
