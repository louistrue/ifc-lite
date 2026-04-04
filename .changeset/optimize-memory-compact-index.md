---
'@ifc-lite/parser': patch
'@ifc-lite/data': patch
'@ifc-lite/cache': patch
---

Optimize memory usage by adding `CompactEntityIndexBuilder` for streaming entity index construction and `EntityTable.getTypeEnum()` for lightweight type lookups without full attribute extraction.
