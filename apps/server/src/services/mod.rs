// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Service modules for IFC processing and caching.

pub mod cache;
pub mod parquet;
pub mod parquet_optimized;
pub mod processor;
pub mod streaming;

pub use cache::DiskCache;
pub use parquet::{serialize_to_parquet, ParquetError};
pub use parquet_optimized::{serialize_to_parquet_optimized_with_stats, OptimizedStats, VERTEX_MULTIPLIER};
pub use processor::process_geometry;
pub use streaming::process_streaming;
