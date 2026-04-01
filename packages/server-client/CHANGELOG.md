# @ifc-lite/server-client

## 1.15.2

### Patch Changes

- [#494](https://github.com/louistrue/ifc-lite/pull/494) [`ec0d3a0`](https://github.com/louistrue/ifc-lite/commit/ec0d3a0e4c7f9eaeb26ab0a724fd76d955e52ac5) Thanks [@louistrue](https://github.com/louistrue)! - Remove recursive package `prebuild` hooks and run TypeScript via `pnpm exec` so workspace builds resolve correctly on Windows.

## 1.15.1

### Patch Changes

- [#461](https://github.com/louistrue/ifc-lite/pull/461) [`6ce40dd`](https://github.com/louistrue/ifc-lite/commit/6ce40ddb0cace5f83c2438d2d4c4bd47703468f7) Thanks [@louistrue](https://github.com/louistrue)! - Clean up package build health for georeferencing work by fixing parser generation issues, making export tests resolve workspace packages reliably, removing build scripts that masked TypeScript failures, tightening workspace test/build scripts, productizing CLI LOD generation, centralizing IFC GUID utilities in encoding, and adding mutation test coverage for property editing flows.

## 1.15.0

### Minor Changes

- [#456](https://github.com/louistrue/ifc-lite/pull/456) [`e07f960`](https://github.com/louistrue/ifc-lite/commit/e07f960097649c5f63a5abc5f35009949d54a5c0) Thanks [@louistrue](https://github.com/louistrue)! - Add LOD geometry generation, profile projection for 2D drawings, and streaming server integration

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

## 1.2.1

### Patch Changes

- Version sync with @ifc-lite packages

## 1.2.0

### Minor Changes

- ed8f77b: ### New Features

  - **Parquet-Based Serialization**: Implemented Parquet-based mesh serialization for ~15x smaller payloads
  - **BOS-Optimized Parquet Format**: Added ara3d BOS-optimized Parquet format for ~50x smaller payloads
  - **Data Model Extraction**: Implemented data model extraction and serialization to Parquet
  - **Server-Client Integration**: Added high-performance IFC processing server for Railway deployment with API information endpoint
  - **Cache Fast-Path**: Added cache fast-path to streaming endpoint for improved performance

  ### Performance Improvements

  - **Parallelized Serialization**: Parallelized geometry and data model serialization for faster processing
  - **Dynamic Batch Sizing**: Implemented dynamic batch sizing for improved performance in IFC processing
  - **Enhanced Caching**: Enhanced data model handling and caching in Parquet processing

  ### Bug Fixes

  - **Fixed Background Caching**: Fixed data model background caching execution issues
  - **Fixed Cache Directory Detection**: Improved cache directory detection for local development

## 1.2.0

### Minor Changes

- [#66](https://github.com/louistrue/ifc-lite/pull/66) [`ed8f77b`](https://github.com/louistrue/ifc-lite/commit/ed8f77b6eaa16ff93593bb946135c92db587d0f5) Thanks [@louistrue](https://github.com/louistrue)! - ### New Features

  - **Parquet-Based Serialization**: Implemented Parquet-based mesh serialization for ~15x smaller payloads
  - **BOS-Optimized Parquet Format**: Added ara3d BOS-optimized Parquet format for ~50x smaller payloads
  - **Data Model Extraction**: Implemented data model extraction and serialization to Parquet
  - **Server-Client Integration**: Added high-performance IFC processing server for Railway deployment with API information endpoint
  - **Cache Fast-Path**: Added cache fast-path to streaming endpoint for improved performance

  ### Performance Improvements

  - **Parallelized Serialization**: Parallelized geometry and data model serialization for faster processing
  - **Dynamic Batch Sizing**: Implemented dynamic batch sizing for improved performance in IFC processing
  - **Enhanced Caching**: Enhanced data model handling and caching in Parquet processing

  ### Bug Fixes

  - **Fixed Background Caching**: Fixed data model background caching execution issues
  - **Fixed Cache Directory Detection**: Improved cache directory detection for local development
