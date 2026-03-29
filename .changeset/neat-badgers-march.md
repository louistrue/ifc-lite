'@ifc-lite/export': patch
'@ifc-lite/geometry': patch
'@ifc-lite/parser': patch
'@ifc-lite/cli': patch
'@ifc-lite/query': patch
'@ifc-lite/server-client': patch
'@ifc-lite/codegen': patch
---

Clean up package build health for georeferencing work by fixing parser generation issues, making export tests resolve workspace packages reliably, removing build scripts that masked TypeScript failures, tightening workspace test/build scripts, and adding a productized CLI LOD generation command.
