# @ifc-lite/sandbox

## 1.14.2

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.14.2

## 1.14.1

### Patch Changes

- [#283](https://github.com/louistrue/ifc-lite/pull/283) [`071d251`](https://github.com/louistrue/ifc-lite/commit/071d251708388771afd288bc2ef01b4d1a074607) Thanks [@louistrue](https://github.com/louistrue)! - fix: support large IFC files (700MB+) in geometry streaming

  - Add error handling to `collectInstancedGeometryStreaming()` to prevent infinite hang when WASM fails
  - Add adaptive batch sizing for large files in `processInstancedStreaming()`
  - Add 0-result detection warnings when WASM returns no geometry
  - Replace `content.clone()` with `Option::take()` in all async WASM methods to halve peak memory usage

- Updated dependencies []:
  - @ifc-lite/sdk@1.14.1

## 1.14.0

### Patch Changes

- Updated dependencies [[`060eced`](https://github.com/louistrue/ifc-lite/commit/060eced467e67f249822ce0303686083a2d9199c), [`7b81970`](https://github.com/louistrue/ifc-lite/commit/7b81970ea12ba0416651315963c7c6db924657a3)]:
  - @ifc-lite/sdk@1.14.0

## 1.13.0

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.13.0

## 1.12.0

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.12.0

## 1.11.3

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.11.3

## 1.11.1

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.11.1

## 1.11.0

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.11.0

## 1.10.0

### Patch Changes

- Updated dependencies []:
  - @ifc-lite/sdk@1.10.0

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

- Updated dependencies [[`67c0064`](https://github.com/louistrue/ifc-lite/commit/67c00640a0ca344337e5e79d80888d329df9130d), [`67c0064`](https://github.com/louistrue/ifc-lite/commit/67c00640a0ca344337e5e79d80888d329df9130d)]:
  - @ifc-lite/sdk@1.9.0
