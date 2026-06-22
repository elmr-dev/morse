// SPDX-FileCopyrightText: 2026 John Schult, Mark Percival
//
// SPDX-License-Identifier: MIT

import { Shield } from 'lucide-react';
import PageHeader from '@/components/page-header';
import { useDocumentHead } from '@/lib/use-document-head';

const LAST_UPDATED = 'June 22, 2026';

export default function PrivacyPage() {
  useDocumentHead({
    title: 'Privacy Policy',
    description:
      'How MORSE handles your data — decoding stays on your device, accounts are optional, and there is no tracking.',
    path: '/privacy',
  });

  return (
    <div className="pb-6">
      <PageHeader eyebrow="Legal" icon={Shield} title="Privacy Policy">
        Last updated {LAST_UPDATED}
      </PageHeader>

      <div className="max-w-2xl space-y-8 text-sm leading-relaxed text-muted-foreground">
        <section className="space-y-3">
          <p>
            MORSE is a free, open-source Morse code (CW) decoder and practice
            game. This policy explains what data the app does and does not
            handle. The short version: decoding and practice happen entirely in
            your browser, and we only store anything on a server if you choose
            to create an account for the leaderboard.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            What stays on your device
          </h2>
          <p>
            All audio generation, model inference, and scoring run locally in
            your browser. Audio clips you decode, the neural model that decodes
            them, and your accuracy results never leave your device. Your
            gameplay state — including your best scores per tier — is stored in
            your browser&rsquo;s local storage and remains on your device unless
            you sign in.
          </p>
          <p>
            You can use MORSE fully anonymously. Decoding, practice, and the
            &ldquo;Beat the Bot&rdquo; game work without an account and without
            sending any personal data to us.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            What we store if you sign in
          </h2>
          <p>
            Creating an account is optional and exists only to put your scores
            on the shared leaderboard. If you sign in with Google, Discord, or
            GitHub, we store the following in our database (hosted by Supabase):
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              Your email address and basic profile information (such as display
              name and avatar) provided by your chosen sign-in provider.
            </li>
            <li>
              A handle and, optionally, an amateur radio callsign you choose to
              display on the leaderboard.
            </li>
            <li>
              Your QRZ verification status, if you choose to verify your
              callsign.
            </li>
            <li>Your leaderboard scores.</li>
          </ul>
          <p>
            We use this data solely to operate the leaderboard and to display
            your results. We do not use it for advertising, and we do not sell
            or share it with anyone for marketing purposes.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            Third parties
          </h2>
          <p>
            MORSE uses no analytics, no advertising, and no third-party tracking
            scripts. The only external services involved are:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              <span className="font-medium text-foreground">
                Your sign-in provider
              </span>{' '}
              (Google, Discord, or GitHub) — only when you choose to sign in.
              Their handling of your data is governed by their own privacy
              policies.
            </li>
            <li>
              <span className="font-medium text-foreground">Supabase</span> —
              our authentication and database provider, which stores the account
              data listed above.
            </li>
            <li>
              <span className="font-medium text-foreground">QRZ</span> — queried
              only if you choose to verify your callsign, to confirm
              verification.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            Your choices
          </h2>
          <p>
            You can clear all locally stored gameplay data at any time by
            clearing your browser&rsquo;s storage for this site. If you have an
            account and would like it deleted, including your leaderboard
            entries, contact us at the email below and we will remove it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Children</h2>
          <p>
            MORSE is a general-audience tool and is not directed at children
            under 13. We do not knowingly collect personal information from
            children under 13.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Changes</h2>
          <p>
            We may update this policy as the app evolves. Material changes will
            be reflected by the &ldquo;last updated&rdquo; date above.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p>
            Questions about this policy or your data? Reach us at{' '}
            <a
              href="mailto:hello@elmr.dev"
              className="text-foreground underline underline-offset-4"
            >
              hello@elmr.dev
            </a>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
