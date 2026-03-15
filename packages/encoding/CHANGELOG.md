# @ifc-lite/encoding

## 1.14.4

### Patch Changes

- [#357](https://github.com/louistrue/ifc-lite/pull/357) [`40bf3d0`](https://github.com/louistrue/ifc-lite/commit/40bf3d00cb5d5ef3512b96cd5e066442adcaab87) Thanks [@louistrue](https://github.com/louistrue)! - Improve IFC STEP string handling by implementing robust decode support for `\\S\\`, `\\X\\`, `\\X2\\...\\X0\\`, `\\X4\\...\\X0\\`, and `\\P.\\` directives, and add `encodeIfcString` for producing STEP-safe string escapes.

## 1.14.3

## 1.14.2

## 1.14.1

## 1.14.0

## 1.13.0

## 1.12.0

## 1.11.3

## 1.11.1

## 1.11.0

## 1.10.0

## 1.9.0

## 1.8.0

## 1.7.0

### Minor Changes

- [#196](https://github.com/louistrue/ifc-lite/pull/196) [`0967cfe`](https://github.com/louistrue/ifc-lite/commit/0967cfe9a203141ee6fc7604153721396f027658) Thanks [@louistrue](https://github.com/louistrue)! - Add @ifc-lite/encoding and @ifc-lite/lists packages

  - `@ifc-lite/encoding`: IFC string decoding and property value parsing (zero dependencies)
  - `@ifc-lite/lists`: Configurable property list engine with column discovery, presets, and CSV export
  - Both packages expose headless APIs via `ListDataProvider` interface for framework-agnostic usage
  - Viewer updated to consume these packages via `createListDataProvider()` adapter
