---
"@ifc-lite/renderer": patch
---

Orbit now pivots around the 3D point under the cursor. At the start of every orbit drag (mouse or touch), a raycast determines what the user is looking at and uses that as the rotation center. If the cursor is over empty space, falls back to the camera target. Removes the old selection-based orbit center which was less intuitive.
