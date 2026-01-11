//! IFC-Lite WebAssembly Bindings
//!
//! JavaScript/TypeScript API for IFC-Lite built with wasm-bindgen.

use wasm_bindgen::prelude::*;

#[cfg(feature = "console_error_panic_hook")]
pub use console_error_panic_hook::set_once as set_panic_hook;

mod utils;
mod zero_copy;
mod api;

pub use utils::set_panic_hook as init_panic_hook;
pub use zero_copy::{ZeroCopyMesh, get_memory};
pub use api::IfcAPI;

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Get the version of IFC-Lite
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
