/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[EmbedViewer] Unhandled error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#f7768e', background: '#1a1b26',
        }}>
          <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '400px' }}>
            <p style={{ fontSize: '1rem', fontWeight: 700 }}>Viewer Error</p>
            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.5rem' }}>
              {this.state.error.message}
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
