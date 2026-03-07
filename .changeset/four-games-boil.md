---
'@ifc-lite/create': patch
'@ifc-lite/sdk': patch
'@ifc-lite/sandbox': patch
---

Add `addIfcGableRoof`, `addIfcWallDoor`, and `addIfcWallWindow` to the creation API and expose them through the sandbox bridge.

Add richer IFC-aware query access in the sandbox for selection, containment, spatial paths, storeys, and single property/quantity lookups.

Harden geometry generation guidance and validation so scripts use the correct roof and wall-hosted opening helpers, and improve prompt context around hierarchy, selection, and storey structure for multi-level generation.
