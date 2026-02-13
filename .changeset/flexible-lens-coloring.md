---
"@ifc-lite/lens": minor
"@ifc-lite/renderer": minor
---

Add flexible lens coloring system with GPU overlay rendering

- Color overlay system: renders lens colors on top of original geometry using depth-equal pipeline, eliminating batch rebuild and framerate drops
- Auto-color by any IFC data: properties, quantities, classifications, materials, attributes, and class
- Dynamic discovery of available data from loaded models (lazy on-demand for properties, quantities, classifications, materials)
- Classification system selector in AutoColorEditor (separates Uniclass/OmniClass)
- Unlimited unique colors with sortable legend
