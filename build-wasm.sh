#!/bin/bash
set -e

echo "🦀 Building IFC-Lite WASM..."

# Build with wasm-pack
echo "📦 Running wasm-pack..."
wasm-pack build rust/wasm-bindings \
  --target web \
  --out-dir ../../packages/wasm/pkg \
  --out-name ifc-lite \
  --release

# Optimize with wasm-opt
echo "⚡ Optimizing with wasm-opt..."
if command -v wasm-opt &> /dev/null; then
  wasm-opt -Oz \
    --enable-bulk-memory \
    --enable-simd \
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
