---
"@ifc-lite/geometry": patch
---

Declare `@ifc-lite/data` as a runtime dependency.

The package already imported `createLogger` from `@ifc-lite/data` but did not list
it in `dependencies`, causing resolution failures for consumers installing from npm.
