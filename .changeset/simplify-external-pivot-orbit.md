---
"@ifc-lite/renderer": patch
---

Simplify external pivot orbit to match viewer-embed approach: target snaps to pivot, position orbits with plain spherical coords + phi clamping. Removes Rodrigues rotation, look-vector tracking, and clampLookVertical — same behavior with ~80% less code. No flips, no stuck poles, no axis inversion.
