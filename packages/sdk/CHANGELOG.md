# @ifc-lite/sdk

## 1.10.0

### Patch Changes

- Updated dependencies [[`3823bd0`](https://github.com/louistrue/ifc-lite/commit/3823bd03bb0b5165d811cfd1ddfed671b8af97d8)]:
  - @ifc-lite/data@1.10.0
  - @ifc-lite/parser@1.10.0
  - @ifc-lite/ids@1.10.0
  - @ifc-lite/lists@1.10.0
  - @ifc-lite/bcf@1.10.0
  - @ifc-lite/drawing-2d@1.10.0
  - @ifc-lite/encoding@1.10.0
  - @ifc-lite/export@1.10.0
  - @ifc-lite/lens@1.10.0
  - @ifc-lite/mutations@1.10.0
  - @ifc-lite/query@1.10.0
  - @ifc-lite/spatial@1.10.0

## 1.9.0

### Minor Changes

- [#227](https://github.com/louistrue/ifc-lite/pull/227) [`67c0064`](https://github.com/louistrue/ifc-lite/commit/67c00640a0ca344337e5e79d80888d329df9130d) Thanks [@louistrue](https://github.com/louistrue)! - Add scripting platform with sandboxed TypeScript execution and full BIM SDK.

  New packages:

  - `@ifc-lite/sandbox` — sandboxed script runner that transpiles and executes user TypeScript in a Web Worker with BIM globals (`bim.query`, `bim.select`, `bim.viewer`, etc.) isolated from the host page.
  - `@ifc-lite/sdk` — BIM SDK defining the full host↔sandbox message protocol and all namespaces: `query`, `mutate`, `viewer`, `spatial`, `export`, `lens`, `bcf`, `ids`, `drawing`, `list`, `events`.

  New viewer features:

  - **Command Palette** — `Cmd/Ctrl+K` fuzzy-search launcher for viewer actions and scripts.
  - **Script Panel** — full-screen code editor (CodeMirror) with run/stop controls, output log, and CSV download.
  - **6 built-in script templates** — quantity takeoff, fire-safety check, MEP equipment schedule, envelope check, space validation, federation compare.
  - **Recent files** — persisted list of previously opened IFC files.

### Patch Changes

- [#227](https://github.com/louistrue/ifc-lite/pull/227) [`67c0064`](https://github.com/louistrue/ifc-lite/commit/67c00640a0ca344337e5e79d80888d329df9130d) Thanks [@louistrue](https://github.com/louistrue)! - Fix scripting CSV exports missing property and quantity data.

  - `@ifc-lite/sdk` export namespace now resolves quantity-set dot-paths (`Qto_WallBaseQuantities.NetVolume`) in addition to property-set paths, so quantity columns are no longer empty in exports.
  - All 6 built-in script templates (quantity takeoff, fire-safety check, MEP schedule, envelope check, space validation, data-quality audit) updated to dynamically discover and include relevant property/quantity columns instead of hardcoding minimal attribute lists.

- Updated dependencies []:
  - @ifc-lite/bcf@1.9.0
  - @ifc-lite/data@1.9.0
  - @ifc-lite/drawing-2d@1.9.0
  - @ifc-lite/encoding@1.9.0
  - @ifc-lite/export@1.9.0
  - @ifc-lite/ids@1.9.0
  - @ifc-lite/lens@1.9.0
  - @ifc-lite/lists@1.9.0
  - @ifc-lite/mutations@1.9.0
  - @ifc-lite/parser@1.9.0
  - @ifc-lite/query@1.9.0
  - @ifc-lite/spatial@1.9.0
