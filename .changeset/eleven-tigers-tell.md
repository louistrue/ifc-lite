---
"@ifc-lite/parser": patch
"@ifc-lite/geometry": patch
"@ifc-lite/wasm": patch
---

### Bug Fixes

- **Critical memory leak fix**: Fixed infinite loop in streaming parser that caused 40GB+ memory consumption by properly terminating the stream after Completed event
- **CI compliance**: Fixed ~30 clippy warnings including `.get(0)` → `.first()` conversions, unused imports, and other code quality improvements
- **Documentation fixes**: Fixed unclosed HTML tags in rustdoc comments

### Internal Improvements

- Added `taplo.toml` configuration for consistent TOML formatting
- Added `scripts/test-ci-locally.sh` for local CI validation
- Formatted and sorted all Cargo.toml files for consistency
- All code now passes strict CI checks with `-D warnings` (treat warnings as errors)
