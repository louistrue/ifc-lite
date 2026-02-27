# create-ifc-lite

## 1.11.4

### Patch Changes

- [#260](https://github.com/louistrue/ifc-lite/pull/260) [`e342a43`](https://github.com/louistrue/ifc-lite/commit/e342a430c07b4611b94225a74776e9855bf1450a) Thanks [@louistrue](https://github.com/louistrue)! - Fix WASM loading in threejs template: add `vite-plugin-wasm` and `vite-plugin-top-level-await` to vite config. Without these plugins Vite cannot serve the `.wasm` file with the correct `application/wasm` MIME type, causing a `CompileError: wasm validation error` at runtime.

## 1.11.3

### Patch Changes

- [#257](https://github.com/louistrue/ifc-lite/pull/257) [`025d3b1`](https://github.com/louistrue/ifc-lite/commit/025d3b14161e63045f8c79b58b49c7da4d91594b) Thanks [@louistrue](https://github.com/louistrue)! - Fix all template TypeScript errors caught by new CI audit:

  - basic template: add `@types/node` + `types: ["node"]` in tsconfig; fix `Buffer` → `ArrayBuffer` conversion when calling `IfcParser.parse()`
  - Add `test-templates.yml` CI workflow that scaffolds every template, runs `npm install` + `tsc --noEmit` (+ `vite build` for threejs) on every PR touching `packages/create-ifc-lite`

- [#257](https://github.com/louistrue/ifc-lite/pull/257) [`b1dd28b`](https://github.com/louistrue/ifc-lite/commit/b1dd28beccbec361651dc61d71a9b32d12b03071) Thanks [@louistrue](https://github.com/louistrue)! - Fix TypeScript error in generated Three.js template: use non-null assertions on DOM element declarations so type narrowing works across function boundaries.

## 1.11.2

### Patch Changes

- [#251](https://github.com/louistrue/ifc-lite/pull/251) [`a13e5c0`](https://github.com/louistrue/ifc-lite/commit/a13e5c04eaf6369815eb66af5174a724a4e38937) Thanks [@louistrue](https://github.com/louistrue)! - Fix TypeScript errors in generated Three.js template: add explicit type casts for `HTMLCanvasElement` and `HTMLInputElement` DOM queries; disable OrbitControls damping for sharp camera stops.

## 1.8.1

### Patch Changes

- [#227](https://github.com/louistrue/ifc-lite/pull/227) [`67c0064`](https://github.com/louistrue/ifc-lite/commit/67c00640a0ca344337e5e79d80888d329df9130d) Thanks [@louistrue](https://github.com/louistrue)! - Fix react template generating wrong `@ifc-lite/*` versions in package.json.

  Previously all workspace dependencies were replaced with the latest version of
  `@ifc-lite/parser`, which broke installs when a package (e.g. `@ifc-lite/sandbox`)
  had not yet been published at that version. Each package is now queried
  individually from the npm registry so the generated package.json always
  references the actual published version of every dependency.

## 1.6.1

### Patch Changes

- [#182](https://github.com/louistrue/ifc-lite/pull/182) [`5e78765`](https://github.com/louistrue/ifc-lite/commit/5e78765139b6c9c28612ae3f9e58760ccc9b524e) Thanks [@louistrue](https://github.com/louistrue)! - Fix **APP_VERSION** not defined error in react template by adding Vite define config

## 1.1.8

### Patch Changes

- 8cb195d: Fix Ubuntu setup issues and monorepo resolution.
  - Fix `@ifc-lite/parser` worker resolution for Node.js/tsx compatibility
  - Fix `create-ifc-lite` to properly replace `workspace:` protocol in templates
