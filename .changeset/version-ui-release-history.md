---
"@ifc-lite/viewer": minor
---

Add version, build date, and release history to viewer UI

- Display version from package.json with build date in About tab
- Add "What's New" tab showing changelog highlights from all packages
- Show version in StatusBar (bottom right)
- Changelog parser extracts and deduplicates highlights at build time
- Color-coded icons: green=feature, amber=fix, blue=perf
