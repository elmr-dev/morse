import faviconUrl from '@morse/brand/decoder/icon.svg';
import { restoreStateCurrent, StateFlags } from '@tauri-apps/plugin-window-state';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app';
import './index.css';

// Follow the OS light/dark preference: the shared theme's `dark` variant keys on
// a `.dark` class on <html>. Toggle it from prefers-color-scheme and keep it in
// sync if the system theme changes while the app is open. (Replaces the old
// `color-scheme: light dark` stopgap.)
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function syncColorScheme(): void {
  document.documentElement.classList.toggle('dark', darkQuery.matches);
}
syncColorScheme();
darkQuery.addEventListener('change', syncColorScheme);

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
