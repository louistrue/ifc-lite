---
"@ifc-lite/renderer": patch
---

Fix external pivot orbit: use Rodrigues axis-angle rotation (Blender-style turntable) instead of independent spherical-coord clamping. Fixes inverted vertical direction, getting stuck at poles, and model flip when look direction approaches vertical. Adds clampLookVertical to prevent view matrix degeneracy while still allowing views from 89.4° above or below.
