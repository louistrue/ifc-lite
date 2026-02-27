# create-ifc-lite

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
