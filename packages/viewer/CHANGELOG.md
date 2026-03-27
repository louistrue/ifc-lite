# @ifc-lite/viewer-core

## 0.2.2

### Patch Changes

- [#432](https://github.com/louistrue/ifc-lite/pull/432) [`113bafc`](https://github.com/louistrue/ifc-lite/commit/113bafc07436c809a8cb24d8682cf63ae5ed99e9) Thanks [@louistrue](https://github.com/louistrue)! - Fix `ifc-lite view` WASM package resolution on Windows by converting module file URLs with `fileURLToPath`, which avoids duplicated drive prefixes and decodes spaces in installed paths.

- [#432](https://github.com/louistrue/ifc-lite/pull/432) [`113bafc`](https://github.com/louistrue/ifc-lite/commit/113bafc07436c809a8cb24d8682cf63ae5ed99e9) Thanks [@louistrue](https://github.com/louistrue)! - Serve generated `@ifc-lite/wasm` snippet assets from the embedded viewer server so `ifc-lite view` can load the rayon worker helper modules at runtime in addition to resolving Windows package paths correctly.

- Updated dependencies [[`113bafc`](https://github.com/louistrue/ifc-lite/commit/113bafc07436c809a8cb24d8682cf63ae5ed99e9), [`113bafc`](https://github.com/louistrue/ifc-lite/commit/113bafc07436c809a8cb24d8682cf63ae5ed99e9)]:
  - @ifc-lite/wasm@1.14.6

## 0.2.1

### Patch Changes

- [#411](https://github.com/louistrue/ifc-lite/pull/411) [`af1ef14`](https://github.com/louistrue/ifc-lite/commit/af1ef1422d41fb4f7bb7f63720cca96ef7fe5515) Thanks [@louistrue](https://github.com/louistrue)! - Simplify orbit behavior: remove dynamic pivot and use camera target. Update frustum utilities and viewer HTML integration.

- Updated dependencies [[`af1ef14`](https://github.com/louistrue/ifc-lite/commit/af1ef1422d41fb4f7bb7f63720cca96ef7fe5515), [`f0da00c`](https://github.com/louistrue/ifc-lite/commit/f0da00c162f2713ed9144691d52c75a21faa18dd)]:
  - @ifc-lite/wasm@1.14.5

## 0.2.0

### Minor Changes

- [#388](https://github.com/louistrue/ifc-lite/pull/388) [`30e4f04`](https://github.com/louistrue/ifc-lite/commit/30e4f048dba5e615f44d3d358cdec56dfc83eb14) Thanks [@louistrue](https://github.com/louistrue)! - Add 3D viewer package and CLI `view`/`analyze` commands for interactive browser-based model visualization with REST API
