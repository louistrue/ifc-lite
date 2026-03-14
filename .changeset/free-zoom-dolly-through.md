---
"@ifc-lite/renderer": patch
---

Remove all zoom restrictions and implement dolly-zoom for unrestricted scene traversal. Zoom now splits each step between distance reduction and forward travel, preventing the Zeno's paradox effect where the camera asymptotically approaches the target but never passes it. Refactor camera-controls to extract vec3/spherical helpers, eliminate duplicated orbit math, and use named constants.
