/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * IFC-Lite Desktop Application Entry Point
 *
 * This uses the same React viewer as the web version,
 * but with native Rust processing via Tauri commands.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

// Import the shared viewer app and styles
import App from '@/App';
import '@/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
