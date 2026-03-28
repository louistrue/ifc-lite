#!/bin/bash
set -e

# Get script directory and root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# Source cargo environment if available (adds cargo to PATH)
if [ -f "$HOME/.cargo/env" ]; then
  source "$HOME/.cargo/env"
fi

echo "🦀 Building IFC-Lite WASM..."

# Build with wasm-pack
echo "📦 Running wasm-pack..."

# Find wasm-pack - check PATH first, then cargo bin directory
WASM_PACK="wasm-pack"
if ! command -v wasm-pack &> /dev/null; then
  # Try cargo's bin directory (common location for cargo-installed binaries)
  CARGO_BIN="$HOME/.cargo/bin/wasm-pack"
  if [ -f "$CARGO_BIN" ]; then
    WASM_PACK="$CARGO_BIN"
    echo "   Using wasm-pack from cargo bin: $WASM_PACK"
  else
    echo "❌ Error: wasm-pack not found in PATH or ~/.cargo/bin/"
    echo "   Install with: cargo install wasm-pack"
    exit 1
  fi
fi

# Check if debug_geometry feature should be enabled
FEATURES=""
if [ "${DEBUG_GEOMETRY:-}" = "1" ]; then
  FEATURES="--features debug_geometry"
  echo "🔍 Building with debug_geometry feature enabled"
fi

# Build WASM binary.
# NOTE: wasm-bindgen-rayon was removed (incompatible with Vite production builds).
# The .cargo/config.toml uses build-std=["std","panic_abort"] which requires nightly.
# wasm-bindgen is pinned to 0.2.106 in Cargo.toml for stability.
rustup run nightly-2025-11-15 "$WASM_PACK" build rust/wasm-bindings \
  --target web \
  --out-dir ../../packages/wasm/pkg \
  --out-name ifc-lite \
  --release \
  $FEATURES

# NOTE: wasm-opt is disabled.
# Multiple wasm-opt versions (npm and cargo) have been tested and all miscompile
# the wasm-bindgen closure/async machinery when --enable-threads is used,
# causing RuntimeError: unreachable in production. The Rust compiler's LLVM -O3
# (release profile) provides sufficient optimization.
echo "ℹ️  wasm-opt disabled — using LLVM -O3 only"

# Show bundle size
echo ""
echo "📊 Bundle size:"
ls -lh packages/wasm/pkg/ifc-lite_bg.wasm | awk '{print "   WASM: " $5}'

WASM_SIZE=$(wc -c < packages/wasm/pkg/ifc-lite_bg.wasm)
TARGET_SIZE=$((1100 * 1024))  # 1100 KB target (larger without wasm-opt)

if [ $WASM_SIZE -lt $TARGET_SIZE ]; then
  echo "   ✅ Under target!"
else
  echo "   ⚠️  Over target ($(($WASM_SIZE / 1024))KB)"
fi

echo ""
echo "✨ Build complete!"
