# @ifc-lite/create

## 1.14.3

### Patch Changes

- [#309](https://github.com/louistrue/ifc-lite/pull/309) [`041ddb4`](https://github.com/louistrue/ifc-lite/commit/041ddb4a40c7e23b08fb7b7ce42690a9cc9708a0) Thanks [@louistrue](https://github.com/louistrue)! - Add `addIfcGableRoof`, `addIfcWallDoor`, and `addIfcWallWindow` to the creation API and expose them through the sandbox bridge.

  Add richer IFC-aware query access in the sandbox for selection, containment, spatial paths, storeys, and single property/quantity lookups.

  Harden geometry generation guidance and validation so scripts use the correct roof and wall-hosted opening helpers, and improve prompt context around hierarchy, selection, and storey structure for multi-level generation.

## 1.14.2

## 1.14.1

## 1.14.0

### Minor Changes

- [#274](https://github.com/louistrue/ifc-lite/pull/274) [`060eced`](https://github.com/louistrue/ifc-lite/commit/060eced467e67f249822ce0303686083a2d9199c) Thanks [@louistrue](https://github.com/louistrue)! - Rename all public API methods to IFC EXPRESS names (`addWall` → `addIfcWall`, `addStorey` → `addIfcBuildingStorey`, etc.), fix STEP serialisation bugs (exponent notation, `IfcQuantityCount` trailing dot, `FILE_DESCRIPTION` double parentheses), add safety guards (`toIfc()` finalize-once, stair riser validation, `vecNorm` zero-length throw, `trackElement` missing-storey throw), and harden SDK create namespace (`download()` throws on missing backend, PascalCase params in `building()` helper).
