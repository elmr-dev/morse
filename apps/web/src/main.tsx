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
import { isStandalone } from './lib/use-standalone';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');
createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <ScrollToTop />
        {/* pb reserves room for the fixed bottom tab bar so content and footer
            never hide behind it. In a browser the bar is mobile-only, so the
            padding clears at sm; in standalone the bar shows at all widths, so
            the padding must persist at all widths. */}
        <div
          className={
            isStandalone()
              ? 'min-h-screen flex flex-col pb-20'
              : 'min-h-screen flex flex-col pb-20 sm:pb-0'
          }
        >
          <div className="w-full max-w-[900px] mx-auto px-5 pt-4">
            <App />
          </div>
          <div className="mt-auto">
            <Footer />
          </div>
        </div>
        <MobileTabBar />
        <PwaUpdatePrompt />
        <OfflineProvisioner />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
