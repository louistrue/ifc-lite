---
"@ifc-lite/viewer": minor
"@ifc-lite/ifcx": minor
"@ifc-lite/parser": minor
"@ifc-lite/renderer": patch
---

Add IFC5 federated loading support with layer composition

## Features

- **Federated IFCX Loading**: Load multiple IFCX files that compose into a unified model
  - Supports the IFC5/IFCX Entity-Component-System architecture
  - Later files in the composition chain override earlier files (USD-inspired semantics)
  - Properties from overlay files merge with base geometry files

- **Models Panel Integration**: Show all federated layers in the Models panel
  - Each layer (base + overlays) displayed as a separate entry
  - Overlay-only files (no geometry) shown with data indicator
  - Toggle visibility per layer

- **Add Overlay via "+" Button**: Add IFCX overlay files to existing models
  - Works with both single-file and already-federated IFCX models
  - Automatically re-composes with new overlay as strongest layer
  - Preserves original files for future re-composition

## Fixes

- **Property Panel Layout**: Long property strings no longer push other values off-screen
  - Changed from flexbox to CSS grid layout
  - Individual horizontal scroll on each property value

- **3D Selection Highlighting**: Fixed race condition that broke highlighting after adding overlays
  - Geometry now comes exclusively from models Map (not legacy state)
  - Meshes correctly tagged with modelIndex for multi-model selection

- **ID Range Tracking**: Fixed maxExpressId calculation for proper entity resolution
  - resolveGlobalIdFromModels now correctly finds entities across federated layers

## Technical Details

- New `LayerStack` class manages ordered composition with strongest-to-weakest semantics
- New `PathIndex` class enables efficient cross-layer entity lookups
- `parseFederatedIfcx` function handles multi-file composition
- Viewer auto-detects when multiple IFCX files are loaded together
