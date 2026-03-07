---
'@ifc-lite/export': patch
'@ifc-lite/sdk': patch
'@ifc-lite/sandbox': patch
---

Expose uploaded chat attachments to sandbox scripts through `bim.files.*`, teach the LLM prompt to reuse those files instead of `fetch()`, and add first-class root attribute mutation support for script/export workflows.
