// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! Request types for the API.

use serde::Deserialize;

/// Options for parsing requests.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ParseOptions {
    /// Skip cache lookup if true.
    #[serde(default)]
    pub skip_cache: bool,

    /// Batch size for streaming responses.
    #[serde(default)]
    pub batch_size: Option<usize>,
}
