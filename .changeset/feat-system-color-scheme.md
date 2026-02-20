---
"@ifc-lite/viewer": minor
---

Respect system color-scheme preference on initial load.

The app previously hardcoded dark mode. Now:

- An inline script in `index.html` applies the correct theme class before first paint, eliminating flash of wrong theme.
- The Zustand UI store reads from `localStorage` first, then falls back to the browser's `prefers-color-scheme` media query.
- Theme preference persists across reloads via `localStorage`.
