---
"@ifc-lite/renderer": patch
---

Rework walk mode: arrow keys and WASD now move on a fixed horizontal plane with scene-proportional speed and smooth acceleration (velocity lerping). Shift-to-sprint doubles movement speed. Mouse drag in walk mode does full orbit (look around) instead of partial orbit + zoom. Remove orbit and pan tools from toolbar — orbit is the default mouse behavior and pan is accessible via middle/right-click.
