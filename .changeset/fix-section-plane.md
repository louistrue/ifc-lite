---
"@ifc-lite/renderer": patch
---

Fix section plane activation and clipping behavior.
- Section plane now only active when Section tool is selected
- Fixed section plane bounds to use model geometry bounds
- Simplified section plane axis to x/y/z coordinates
- Fixed visual section plane rendering with proper depth testing
