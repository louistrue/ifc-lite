---
"@ifc-lite/renderer": minor
---

Add basket-based multi-isolation with incremental add/remove

- Basket isolation system: build an isolation set incrementally with `=` (set), `+` (add), `−` (remove) via keyboard, toolbar, or context menu
- Cmd/Ctrl+Click multi-select feeds directly into basket operations — select multiple entities, then press `+` to add them all
- Spacebar as additional shortcut to hide selected entity (alongside Delete/Backspace)
- Escape now clears basket along with selection and filters
- Toolbar shows active basket with entity count badge; context menu exposes Set/Add/Remove actions per entity
- Unified EntityRef resolution via `resolveEntityRef()` — single source of truth for globalId-to-model mapping across all UI surfaces
- Fix: Cmd+Click multi-select now works reliably in all model configurations (single-model, multi-model, legacy)
