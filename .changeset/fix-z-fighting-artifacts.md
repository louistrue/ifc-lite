---
"@ifc-lite/renderer": patch
---

fix: eliminate z-fighting flicker on coplanar faces

- Upgrade depth buffer from depth24plus to depth32float across all pipelines for optimal precision with reverse-Z
- Add per-entity deterministic depth nudge in vertex shaders using Knuth multiplicative hash to prevent coplanar face flicker
- Refactor depthFormat into InstancedRenderPipeline member to eliminate hardcoded literals
