---
"@ifc-lite/viewer": patch
---

Fix type visibility options (Spaces, Site, Openings) for federated models

The toolbar now aggregates mesh types across all models in the federation map,
ensuring visibility options appear whenever any loaded model contains those types.
Also fixes the Layers button disabled state to account for federated models.
