/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Initialize Mermaid diagrams
document.addEventListener('DOMContentLoaded', function() {
  // Find all mermaid code blocks and convert them
  document.querySelectorAll('pre.mermaid code, pre > code.language-mermaid').forEach(function(code) {
    const pre = code.parentElement;
    const div = document.createElement('div');
    div.className = 'mermaid';
    div.textContent = code.textContent;
    pre.parentElement.replaceChild(div, pre);
  });

  // Initialize mermaid
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({
      startOnLoad: true,
      theme: 'dark',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true
      }
    });
    mermaid.run();
  }
});
