---
"@ifc-lite/parser": patch
"create-ifc-lite": patch
"@ifc-lite/viewer": patch
"@ifc-lite/desktop": patch
---

Fix Ubuntu setup issues and monorepo resolution.
- Fix `@ifc-lite/parser` worker resolution for Node.js/tsx compatibility
- Fix `create-ifc-lite` to properly replace `workspace:` protocol in templates
- Fix monorepo package resolution for `@ifc-lite/ifcx` in viewer and desktop apps
- Align desktop app build target with macOS minimum system version (Safari 15 / macOS 12.0)
