---
'@ifc-lite/viewer-core': patch
---

Fix `ifc-lite view` WASM package resolution on Windows by converting module file URLs with `fileURLToPath`, which avoids duplicated drive prefixes and decodes spaces in installed paths.
