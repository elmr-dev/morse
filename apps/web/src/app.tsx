// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Navigate, Route, Routes } from 'react-router-dom';
import { SiteHeader } from './components/site-nav';
import { useIsStandalone } from './lib/use-standalone';
import AccountPage from './pages/account-page';
import BeatTheBotPage from './pages/beat-the-bot-page';
import DecodePage from './pages/decode-page';
import FaqPage from './pages/faq-page';
import LandingPage from './pages/landing-page';
import LeaderboardPage from './pages/leaderboard-page';

export default function App() {
  const standalone = useIsStandalone();
  return (
    <>
      <SiteHeader />
      <Routes>
        {/* Standalone (installed PWA) has no landing page — home is the
            decoder. start_url stays "/", so this redirect routes the launch. */}
        <Route
          path="/"
          element={
            standalone ? <Navigate to="/decode" replace /> : <LandingPage />
          }
        />
        <Route path="/decode" element={<DecodePage />} />
        <Route path="/beat" element={<Navigate to="/beat-the-bot" replace />} />
        <Route path="/beat-the-bot" element={<BeatTheBotPage />} />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/account" element={<AccountPage />} />
      </Routes>
    </>
  );
}
