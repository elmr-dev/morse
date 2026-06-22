// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useOnlineTransitionToasts } from './components/offline-indicator';
import { SiteHeader } from './components/site-nav';
import AccountPage, {
  BadgeSectionRoute,
  IdentitySection,
  SessionSection,
} from './pages/account-page';
import BeatTheBotPage from './pages/beat-the-bot-page';
import FaqPage from './pages/faq-page';
import LandingPage from './pages/landing-page';
import LeaderboardsPage from './pages/leaderboards-page';

const RedlinePage = lazy(() => import('./pages/redline-page'));

export default function App() {
  useOnlineTransitionToasts();
  return (
    <>
      <SiteHeader />
      <Routes>
        {/* Home is the live Decode demo — the hero, in browser and standalone
            alike (start_url stays "/"). The standalone shell just hides the
            header; the page is the same. */}
        <Route path="/" element={<LandingPage />} />
        {/* Decode no longer has its own route — the demo is the landing hero. */}
        <Route path="/decode" element={<Navigate to="/" replace />} />
        <Route path="/beat" element={<Navigate to="/beat-the-bot" replace />} />
        <Route path="/beat-the-bot" element={<BeatTheBotPage />} />
        <Route
          path="/redline"
          element={
            <Suspense fallback={null}>
              <RedlinePage />
            </Suspense>
          }
        />
        {/* Top-level Leaderboards aggregator + per-trainer deep links. The old
            singular /leaderboard redirects in. */}
        <Route path="/leaderboards" element={<LeaderboardsPage />} />
        <Route path="/leaderboards/:trainer" element={<LeaderboardsPage />} />
        <Route
          path="/leaderboard"
          element={<Navigate to="/leaderboards" replace />}
        />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/account" element={<AccountPage />}>
          <Route index element={<Navigate to="identity" replace />} />
          <Route path="identity" element={<IdentitySection />} />
          <Route path="badge" element={<BadgeSectionRoute />} />
          <Route path="session" element={<SessionSection />} />
        </Route>
      </Routes>
    </>
  );
}
