---
"@ifc-lite/renderer": patch
---

Fix WGSL shader compilation failure on some GPUs and improve Chrome streaming performance

- Move dpdx/dpdy calls outside non-uniform control flow to fix shader validation errors on Chrome/Windows GPUs (e.g. RTX 4070)
- Use mappedAtCreation for vertex/index buffer uploads, eliminating redundant writeBuffer IPC round-trips on Chrome's Dawn backend
- Increase streaming chunk size from 128 to 512 meshes per append to reduce GPU buffer allocation rounds
- Remove noisy FederationRegistry "Unknown model" console warnings during single-model loading
