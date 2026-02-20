---
"create-ifc-lite": patch
---

Fix react template generating wrong `@ifc-lite/*` versions in package.json.

Previously all workspace dependencies were replaced with the latest version of
`@ifc-lite/parser`, which broke installs when a package (e.g. `@ifc-lite/sandbox`)
had not yet been published at that version.  Each package is now queried
individually from the npm registry so the generated package.json always
references the actual published version of every dependency.
