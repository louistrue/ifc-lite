---
"@ifc-lite/encoding": patch
---

Improve IFC STEP string handling by implementing robust decode support for `\\S\\`, `\\X\\`, `\\X2\\...\\X0\\`, `\\X4\\...\\X0\\`, and `\\P.\\` directives, and add `encodeIfcString` for producing STEP-safe string escapes.
