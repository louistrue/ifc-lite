---
"@ifc-lite/renderer": patch
---

Fix mesh batching to handle in-place color mutations during streaming

Color array references could be reused and mutated in-place between streaming batches, causing incorrect vertex colors when geometry was merged. The fix clones color data at accumulation time to prevent cross-batch contamination.
