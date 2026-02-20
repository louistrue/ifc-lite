---
"@ifc-lite/sandbox": minor
"@ifc-lite/sdk": minor
"@ifc-lite/viewer": minor
---

Add scripting platform with sandboxed TypeScript execution and full BIM SDK.

New packages:

- `@ifc-lite/sandbox` — sandboxed script runner that transpiles and executes user TypeScript in a Web Worker with BIM globals (`bim.query`, `bim.select`, `bim.viewer`, etc.) isolated from the host page.
- `@ifc-lite/sdk` — BIM SDK defining the full host↔sandbox message protocol and all namespaces: `query`, `mutate`, `viewer`, `spatial`, `export`, `lens`, `bcf`, `ids`, `drawing`, `list`, `events`.

New viewer features:

- **Command Palette** — `Cmd/Ctrl+K` fuzzy-search launcher for viewer actions and scripts.
- **Script Panel** — full-screen code editor (CodeMirror) with run/stop controls, output log, and CSV download.
- **6 built-in script templates** — quantity takeoff, fire-safety check, MEP equipment schedule, envelope check, space validation, federation compare.
- **Recent files** — persisted list of previously opened IFC files.
