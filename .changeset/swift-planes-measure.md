---
"@ifc-lite/renderer": patch
---

feat: Add shift+drag orthogonal constraint for measurements

When in measure mode, holding Shift while dragging constrains measurements to orthogonal axes (X, Y, Z). This enables precise horizontal, vertical, and depth measurements.

- Visual axis indicators show available constraint directions (red=X, green=Y, blue=Z)
- Snaps to edges and vertices in orthogonal mode for precision
- Shift+drag before first point allows camera orbit
- Adaptive performance optimization for complex models
