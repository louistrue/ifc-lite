---
"@ifc-lite/renderer": patch
---

Fix external pivot orbit: rotate both position AND target around the pivot instead of snapping target to pivot. Camera stays where it is on click — no view jump, no snap. The look direction is preserved because both endpoints rotate by the same spherical delta.
