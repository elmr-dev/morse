// SPDX-FileCopyrightText: 2026 John Schult, Mark Percival
//
// SPDX-License-Identifier: MIT

import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/page-header';
import { useDocumentHead } from '@/lib/use-document-head';

const LAST_UPDATED = 'June 22, 2026';

export default function TermsPage() {
  useDocumentHead({
    title: 'Terms of Service',
    description:
      'Terms for using MORSE — a free, open-source CW decoder and practice game.',
    path: '/terms',
  });

  return (
    <div className="pb-6">
      <PageHeader eyebrow="Legal" icon={FileText} title="Terms of Service">
        Last updated {LAST_UPDATED}
      </PageHeader>

      <div className="max-w-2xl space-y-8 text-sm leading-relaxed text-muted-foreground">
        <section className="space-y-3">
          <p>
            MORSE is a free, open-source Morse code (CW) decoder and practice
            game. By using it, you agree to these terms. If you don&rsquo;t
            agree, please don&rsquo;t use the app.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            Using MORSE
          </h2>
          <p>
            You may use MORSE for personal, non-commercial purposes: decoding
            CW, practicing, and competing on the leaderboard. The app is
            provided at no cost. Most features work without an account; an
            optional account lets you appear on the shared leaderboard.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            Accounts and the leaderboard
          </h2>
          <p>
            If you create an account, you&rsquo;re responsible for the handle
            and callsign you choose to display. Don&rsquo;t impersonate other
            operators, use a callsign that isn&rsquo;t yours, or submit handles
            that are abusive, offensive, or misleading. We may remove
            leaderboard entries or accounts that violate these terms or attempt
            to manipulate scores.
          </p>
          <p>
            Play fairly. Don&rsquo;t attempt to falsify scores, automate
            submissions, or otherwise game the leaderboard in ways that
            misrepresent results.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            The software and your data
          </h2>
          <p>
            How we handle data is described in our{' '}
            <Link
              to="/privacy"
              className="text-foreground underline underline-offset-4"
            >
              Privacy Policy
            </Link>
            . MORSE&rsquo;s source code is open source; your rights to the code
            itself are governed by the license in our public repository, which
            is separate from these terms of use for the hosted app.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            No warranty
          </h2>
          <p>
            MORSE is provided &ldquo;as is,&rdquo; without warranties of any
            kind. Decoding results, including those in the &ldquo;Beat the
            Bot&rdquo; game, are best-effort and may be inaccurate. Don&rsquo;t
            rely on MORSE for anything safety-critical or for official copying
            of traffic. We don&rsquo;t guarantee the app will be available,
            uninterrupted, or error-free.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">
            Limitation of liability
          </h2>
          <p>
            To the maximum extent permitted by law, the maintainers of MORSE are
            not liable for any damages arising from your use of, or inability to
            use, the app.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Changes</h2>
          <p>
            We may update these terms as the app evolves. Material changes will
            be reflected by the &ldquo;last updated&rdquo; date above. Continued
            use after changes means you accept the updated terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p>
            Questions about these terms? Reach us at{' '}
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
