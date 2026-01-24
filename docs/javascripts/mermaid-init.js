/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Initialize Mermaid diagrams for MkDocs Material with instant loading support
(function() {
  // Wait for mermaid to load
  if (typeof mermaid === 'undefined') {
    return;
  }

  // Detect color scheme
  function getTheme() {
    const scheme = document.body.getAttribute('data-md-color-scheme');
    return scheme === 'slate' ? 'dark' : 'default';
  }

  // Initialize mermaid configuration
  mermaid.initialize({
    startOnLoad: false,
    theme: getTheme(),
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true
    },
    securityLevel: 'loose'
  });

  // Render mermaid diagrams
  function renderMermaid() {
    const elements = document.querySelectorAll('.mermaid:not([data-processed])');
    if (elements.length > 0) {
      mermaid.run({ nodes: elements });
    }
  }

  // Initial render
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderMermaid);
  } else {
    renderMermaid();
  }

  // Re-render on instant navigation (MkDocs Material)
  if (typeof document$ !== 'undefined') {
    document$.subscribe(function() {
      renderMermaid();
    });
  }

  // Fallback: MutationObserver for dynamic content
  var observer = new MutationObserver(function(mutations) {
    var shouldRender = mutations.some(function(mutation) {
      return Array.from(mutation.addedNodes).some(function(node) {
        return node.nodeType === 1 && (
          node.classList && node.classList.contains('mermaid') ||
          node.querySelector && node.querySelector('.mermaid')
        );
      });
    });
    if (shouldRender) {
      renderMermaid();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
