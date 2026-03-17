# Plan: Add `wasm-bindgen-rayon` for Parallel WASM IFC Parsing

## Goal
Enable true multi-threaded parallelism in WASM by integrating `wasm-bindgen-rayon`, removing the sequential fallback in BRep triangulation and getting the same `par_iter()` performance in the browser as on the server.

## Why This Works
- Your COOP/COEP headers are **already set** in `apps/viewer/vite.config.ts:252-256`
- You **already use `build-std`** in `.cargo/config.toml`
- Vite **natively supports** `wasm-bindgen-rayon`'s Worker syntax (no plugins needed)
- Rayon is only used in **one file** (`brep.rs`) with **4 cfg-guarded blocks** — minimal change surface

## Steps

### Step 1: Add `wasm-bindgen-rayon` dependency to wasm-bindings crate

**File: `rust/wasm-bindings/Cargo.toml`**
- Add `wasm-bindgen-rayon = "1.2"` to `[dependencies]`

### Step 2: Export the `initThreadPool` function from WASM

**File: `rust/wasm-bindings/src/lib.rs`**
- Add `pub use wasm_bindgen_rayon::init_thread_pool;` at the top of the file (after the existing `use wasm_bindgen::prelude::*;`)
- This exposes `initThreadPool()` in the generated JS bindings

### Step 3: Update `.cargo/config.toml` rustflags for atomics + shared memory

**File: `.cargo/config.toml`**

Change the `[target.wasm32-unknown-unknown]` section to:
```toml
[target.wasm32-unknown-unknown]
rustflags = [
  "-C", "target-feature=+atomics,+bulk-memory,+mutable-globals",
  "-C", "link-arg=--max-memory=4294967296",
  "-C", "link-arg=--shared-memory",
  "-C", "link-arg=--import-memory",
]
```

Key additions: `+atomics`, `--shared-memory`, `--import-memory`

### Step 4: Update `build-wasm.sh` for nightly + atomics

**File: `scripts/build-wasm.sh`**

- The wasm-pack command needs to use the nightly toolchain and pass `-Z build-std=panic_abort,std`
- Add `--enable-threads` to the wasm-opt flags
- The build-std flag is already in `.cargo/config.toml` so it should be picked up automatically

Update the wasm-pack invocation to:
```bash
rustup run nightly-2025-11-15 "$WASM_PACK" build rust/wasm-bindings \
  --target web \
  --out-dir ../../packages/wasm/pkg \
  --out-name ifc-lite \
  --release \
  $FEATURES \
  -- -Z build-std=panic_abort,std
```

Add `--enable-threads` and `--enable-atomics` to the wasm-opt flags.

### Step 5: Remove cfg guards in `brep.rs` — use `par_iter()` unconditionally

**File: `rust/geometry/src/processors/brep.rs`**

Remove all 4 conditional compilation blocks:

1. **Lines 257-258**: Remove `#[cfg(not(target_arch = "wasm32"))]` guard on `use rayon::prelude::*;` — make it unconditional
2. **Lines 333-343**: Remove both cfg blocks, keep only the `par_iter()` version
3. **Lines 399-400**: Remove `#[cfg(not(target_arch = "wasm32"))]` guard on second rayon import — make it unconditional
4. **Lines 475-485**: Remove both cfg blocks, keep only the `par_iter()` version

After: just `use rayon::prelude::*;` at the top of each function, and `par_iter()` everywhere.

### Step 6: Add `rust-toolchain.toml` for nightly pinning

**File: `rust-toolchain.toml`** (new file in repo root)
```toml
[toolchain]
channel = "nightly-2025-11-15"
components = ["rust-src"]
targets = ["wasm32-unknown-unknown"]
```

This pins the nightly version that `wasm-bindgen-rayon` is tested against. Only affects WASM builds (server can override with stable if needed).

### Step 7: Initialize thread pool from JavaScript

**File: `packages/geometry/src/ifc-lite-bridge.ts`**

Update the `init()` method to call `initThreadPool` after WASM init:

```typescript
import init, { IfcAPI, initThreadPool, ... } from '@ifc-lite/wasm';

async init(): Promise<void> {
  // ... existing checks ...
  await init();
  await initThreadPool(navigator.hardwareConcurrency);
  // ... rest of init ...
}
```

### Step 8: Add feature detection fallback

**File: `packages/geometry/src/ifc-lite-bridge.ts`**

Wrap the `initThreadPool` call with feature detection so browsers without SharedArrayBuffer still work (they just get single-threaded):

```typescript
await init();

// Initialize thread pool if SharedArrayBuffer is available (requires COOP/COEP)
if (typeof SharedArrayBuffer !== 'undefined') {
  try {
    await initThreadPool(navigator.hardwareConcurrency);
  } catch (e) {
    log.warn('Thread pool init failed, falling back to single-threaded:', e);
  }
}
```

Note: `wasm-bindgen-rayon` gracefully falls back — if `initThreadPool` isn't called, rayon uses a single-thread pool. The `par_iter()` code still works, just sequentially.

## Files Changed (Summary)

| File | Change |
|------|--------|
| `rust/wasm-bindings/Cargo.toml` | Add `wasm-bindgen-rayon` dep |
| `rust/wasm-bindings/src/lib.rs` | Export `init_thread_pool` |
| `.cargo/config.toml` | Add `+atomics`, `--shared-memory`, `--import-memory` |
| `scripts/build-wasm.sh` | Use nightly, add thread/atomics flags to wasm-opt |
| `rust/geometry/src/processors/brep.rs` | Remove 4 cfg guards, use `par_iter()` unconditionally |
| `rust-toolchain.toml` | New file — pin nightly version |
| `packages/geometry/src/ifc-lite-bridge.ts` | Import + call `initThreadPool`, with fallback |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Nightly Rust required | Pin to tested version (`nightly-2025-11-15`), only affects WASM target |
| COOP/COEP headers needed | Already configured in vite.config.ts; production needs same headers |
| Older browsers without SharedArrayBuffer | Feature detection fallback — rayon still works single-threaded |
| Bundle size increase | Worker JS is small (~2KB); WASM binary may grow slightly from atomics |
| Main thread can't use `atomic.wait` | Rayon's work-stealing doesn't use `atomic.wait` on the calling thread — it spawns work to the pool |

## Expected Performance Impact

Based on typical BRep-heavy IFC files:
- **Server** (baseline): Already parallel with rayon
- **WASM before**: Sequential — scales linearly with face count
- **WASM after**: Parallel across `navigator.hardwareConcurrency` cores
- **Expected speedup**: 3-6x on typical 4-8 core machines for BRep-heavy models
- **No regression**: Files without BRep geometry are unaffected (triangulated facesets use the fast path, not rayon)
