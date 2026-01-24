/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Initialize Mermaid diagrams for MkDocs Material
// Using fence_div_format, so mermaid elements are already <div class="mermaid">
document.addEventListener('DOMContentLoaded', function() {
  if (typeof mermaid === 'undefined') {
    return;
  }

  // Detect color scheme for theme
  const isDark = document.body.getAttribute('data-md-color-scheme') === 'slate';

  // Initialize mermaid
  mermaid.initialize({
    startOnLoad: true,
    theme: isDark ? 'dark' : 'default',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true
    },
    securityLevel: 'loose'
  });
});
