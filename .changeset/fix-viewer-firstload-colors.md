---
"@ifc-lite/viewer": patch
---

Fix deferred IFC style colors not applying on first load by separating persistent mesh color updates from transient overlay color updates.

This restores expected glass transparency and keeps first-load and cache-load colors consistent.
