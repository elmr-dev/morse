import faviconUrl from '@morse/brand/decoder/icon.svg';
import { restoreStateCurrent, StateFlags } from '@tauri-apps/plugin-window-state';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './index.css';

// Apply the correct theme class SYNCHRONOUSLY before the first React render so
// there is never a frame where CSS variables resolve incorrectly and the
// transparent-title-bar window flashes or goes black. Mirrors the React useState
// initializer in App so the two never disagree on first paint.
const THEME_KEY = 'morse-decoder:themeOverride';
const saved = localStorage.getItem(THEME_KEY);
const initialDark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark', initialDark);

// Restore window size/position from the previous session.
void restoreStateCurrent(StateFlags.SIZE | StateFlags.POSITION);

// Brand favicon, consumed from @morse/brand.
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = faviconUrl;
document.head.appendChild(favicon);

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown) {
    return { error: String(err) };
  }
  override componentDidCatch(err: unknown, info: React.ErrorInfo) {
    console.error('Decoder ErrorBoundary caught:', err, info);
  }
  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '24px', fontFamily: 'monospace', fontSize: '13px', color: 'var(--destructive, #f44)' }}>
          <strong>Render error</strong>
          <pre style={{ marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
