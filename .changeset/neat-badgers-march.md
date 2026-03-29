'@ifc-lite/export': patch
'@ifc-lite/geometry': patch
'@ifc-lite/parser': patch
'@ifc-lite/cli': patch
'@ifc-lite/query': patch
'@ifc-lite/server-client': patch
'@ifc-lite/codegen': patch
'@ifc-lite/encoding': patch
'@ifc-lite/bcf': patch
'@ifc-lite/mutations': patch
---

Clean up package build health for georeferencing work by fixing parser generation issues, making export tests resolve workspace packages reliably, removing build scripts that masked TypeScript failures, tightening workspace test/build scripts, productizing CLI LOD generation, centralizing IFC GUID utilities in encoding, and adding mutation test coverage for property editing flows.
