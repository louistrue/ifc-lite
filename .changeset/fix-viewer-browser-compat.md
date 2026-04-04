---
"@ifc-lite/viewer": patch
---

Fix browser build warnings and improve streaming reliability

- Silence FileDialog Tauri warnings in browser builds (expected fallback path)
- Fix closeGeometryIterator ReferenceError when geometry processor throws before iterator creation
- Guard timer-based queue pump behind document.hidden to prevent redundant GPU flushes in foreground tabs
