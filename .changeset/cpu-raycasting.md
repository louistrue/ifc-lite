---
"@ifc-lite/renderer": minor
---

### New Features

- **CPU Raycasting for Picking**: Added CPU raycasting support for picking large models, improving interaction performance for complex scenes

### Bug Fixes

- **Fixed Ray Origin**: Fixed ray origin to use camera position for accurate CPU picking
- **Fixed Raycasting Logic**: Improved raycasting logic to always use CPU raycasting when batched meshes exist and creation threshold is exceeded
