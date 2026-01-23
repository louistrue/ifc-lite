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

"$WASM_PACK" build rust/wasm-bindings \
  --target web \
  --out-dir ../../packages/wasm/pkg \
  --out-name ifc-lite \
  --release \
  $FEATURES

# Optimize with wasm-opt
echo "⚡ Optimizing with wasm-opt..."
if command -v wasm-opt &> /dev/null; then
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-mutable-globals \
    --enable-nontrapping-float-to-int \
    --enable-sign-ext \
    packages/wasm/pkg/ifc-lite_bg.wasm \
    -o packages/wasm/pkg/ifc-lite_bg.wasm
  echo "✅ Optimized with wasm-opt"
else
  echo "⚠️  wasm-opt not found, skipping optimization"
  echo "   Install with: npm install -g wasm-opt"
fi

# Show bundle size
echo ""
echo "📊 Bundle size:"
ls -lh packages/wasm/pkg/ifc-lite_bg.wasm | awk '{print "   WASM: " $5}'

WASM_SIZE=$(wc -c < packages/wasm/pkg/ifc-lite_bg.wasm)
TARGET_SIZE=$((800 * 1024))  # 800 KB target

if [ $WASM_SIZE -lt $TARGET_SIZE ]; then
  echo "   ✅ Under 800KB target!"
else
  echo "   ⚠️  Over 800KB target ($(($WASM_SIZE / 1024))KB)"
fi

echo ""
echo "✨ Build complete!"
