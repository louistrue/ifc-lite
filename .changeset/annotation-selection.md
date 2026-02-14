---
"@ifc-lite/viewer": minor
---

Add annotation selection, deletion, move, and text re-editing in 2D drawings

- Click any annotation (measure, polygon area, text box, cloud) to select it — highlighted with a dashed blue border and corner handles
- Press Delete/Backspace to remove the selected annotation
- Drag to reposition any selected annotation
- Double-click text annotations to re-enter edit mode
- Escape exits annotation tools back to Select/Pan mode and deselects
- "Select / Pan" option added to annotation toolbar dropdown
- Performance: ephemeral drag state uses local refs instead of store updates, stable coordinate callbacks via refs, hit-test reads from storeRef to prevent callback cascade
