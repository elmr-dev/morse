import faviconUrl from '@morse/brand/decoder/icon.svg';
import { restoreStateCurrent, StateFlags } from '@tauri-apps/plugin-window-state';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './index.css';

// Restore window size/position from the previous session.
void restoreStateCurrent(StateFlags.SIZE | StateFlags.POSITION);

// Brand favicon, consumed from @morse/brand.
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = faviconUrl;
document.head.appendChild(favicon);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
