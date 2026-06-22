// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './app.tsx';
import Footer from './components/footer';
import { OfflineProvisioner } from './components/offline-provisioner';
import { PwaUpdatePrompt } from './components/pwa-update-prompt';
import ScrollToTop from './components/scroll-to-top';
import { MobileTabBar } from './components/site-nav';
import { Toaster } from './components/ui/sonner';
import { AuthProvider } from './lib/auth';
import { SCROLL_ROOT_ID } from './lib/scroll-root';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ScrollToTop />
        {/* Viewport-sized flex column. The middle child owns the page
            scroll so the scrollbar ends at the top edge of the bottom
            tab bar instead of running behind it. MobileTabBar is now in
            flow as the last child (returns null on desktop). */}
        <div className="h-dvh flex flex-col">
          <main
            id={SCROLL_ROOT_ID}
            className="flex-1 min-h-0 overflow-y-auto overflow-x-clip overscroll-contain flex flex-col pb-6"
          >
            <div className="w-full max-w-[900px] mx-auto px-5 pt-4">
              <App />
            </div>
            <div className="mt-auto">
              <Footer />
            </div>
          </main>
          <MobileTabBar />
        </div>
        <PwaUpdatePrompt />
        <OfflineProvisioner />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
