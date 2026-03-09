/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

---
"@ifc-lite/ifcx": major
"@ifc-lite/parser": major
---

Remove the legacy single-parent `ComposedNode.parent` field and `getPathToRoot()` export from the IFCX composition API. IFCX extraction now relies on explicit traversal frames instead of mutable parent pointers, and the build now verifies built `dist` output against the Hello Wall IFCX fixtures.
