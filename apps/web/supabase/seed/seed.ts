// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MORSE — DEV SEED: 50 synthetic operators for leaderboard testing.
 *
 * ⚠️  DEV / STAGING ONLY. Requires the SERVICE-ROLE (secret) key — it creates
 * auth users and bypasses RLS. NEVER run against production. NEVER commit the
 * key.
 *
 * Run:
 *   SUPABASE_URL=https://qhmtjowsknqjkoieqxqk.supabase.co \
 *   SUPABASE_SECRET_KEY=sb_secret_xxxxxxxx \
 *   bun apps/web/supabase/seed/seed.ts
 *
 * Tear down with: bun apps/web/supabase/seed/seed.ts --teardown
 *
 * WHY a script (not raw SQL): profiles.id FKs auth.users, and auth.users has
 * many required columns + triggers that raw INSERT can't satisfy portably. The
 * Admin API (auth.admin.createUser) creates proper, FK-valid auth rows. These
 * accounts can't really log in (random password, unconfirmed) — they exist only
 * to own leaderboard rows, which the app only ever READS.
 *
 * TEARDOWN IS EXACT: every seeded user has an @SEED_DOMAIN email. Teardown
 * deletes exactly those users; ON DELETE CASCADE removes their profiles + bests.
 * `.invalid` is a reserved TLD (RFC 2606) — it can never collide with a real
 * signup.
 *
 * Distribution (deliberate, to exercise the leaderboard UI):
 *   - All 50 get a 'technician' best  → 50 rows → pagination + "outside top 25"
 *     pin fire in that tier.
 *   - First 20 also get 'no-code', first 12 'general', first 6 'extra'
 *     → operators 1–6 are in ALL FOUR tiers → exposes the All-view rank/dedup
 *       question.
 *   - ~40% verified → both shield states render.
 *   - Scores spread with intentional collisions → RANK() ties (1,2,2,4) show.
 */

import { createClient } from '@supabase/supabase-js';

const SEED_DOMAIN = 'seed.morse.invalid';

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !secret) {
  console.error(
    'Missing env. Set SUPABASE_URL and SUPABASE_SECRET_KEY (the sb_secret_ key).'
  );
  process.exit(1);
}

// Service-role client: bypasses RLS, can use the admin API. The disabled auth
// persistence keeps this a pure server-side actor.
const admin = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CALLSIGNS = [
  'W4ABC',
  'K2DEF',
  'N7GHI',
  'AC4JKL',
  'KD9MNO',
  'W1PQR',
  'N0STU',
  'K6VWX',
  'AB1YZA',
  'W5BCD',
  'KE4EFG',
  'N3HIJ',
  'W9KLM',
  'K8NOP',
  'AA2QRS',
  'W7TUV',
  'N5WXY',
  'KG4ZAB',
  'W3CDE',
  'K4FGH',
  'N1IJK',
  'W8LMN',
  'AD5OPQ',
  'K0RST',
  'W6UVW',
  'N2XYZ',
  'KF7ABD',
  'W0CEF',
  'K5GHJ',
  'N4KLN',
  'AE6MOP',
  'W2QRT',
  'KB8UVX',
  'N9YZA',
  'K3BCE',
  'W5DFG',
  'N6HJK',
  'AC7LMO',
  'K1PQS',
  'W4TUW',
  'KD2XYB',
  'N8CDF',
  'W7GHK',
  'K9LMP',
  'AB5QRT',
  'N0UVW',
  'W1XYZ',
  'KE6ABC',
  'G3XYZ',
  'VK2ABC',
];

const clamp = (lo: number, hi: number, v: number) =>
  Math.max(lo, Math.min(hi, Math.round(v)));

interface BestSpec {
  tier: 'no-code' | 'technician' | 'general' | 'extra';
  best: number;
  bot: number;
  minutesAgo: number;
}

/** The bests for operator index n (1-based), per the distribution above. */
function bestsFor(n: number): BestSpec[] {
  const out: BestSpec[] = [];
  // technician — all 50
  out.push({
    tier: 'technician',
    best: clamp(38, 99, 100 - n * 1.15),
    bot: 72 + ((n * 7) % 28),
    minutesAgo: n * 13,
  });
  if (n <= 20)
    out.push({
      tier: 'no-code',
      best: clamp(60, 100, 102 - n * 1.6),
      bot: 80 + ((n * 5) % 20),
      minutesAgo: n * 17,
    });
  if (n <= 12)
    out.push({
      tier: 'general',
      best: clamp(45, 95, 92 - n * 2.0),
      bot: 75 + ((n * 9) % 25),
      minutesAgo: n * 23,
    });
  if (n <= 6)
    out.push({
      tier: 'extra',
      best: clamp(40, 85, 80 - n * 3.0),
      bot: 88 + ((n * 3) % 12),
      minutesAgo: n * 31,
    });
  return out;
}

const isoMinutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

async function teardown() {
  console.log(`Tearing down seed users (@${SEED_DOMAIN})…`);
  // Page through auth users, delete those with the seed domain. CASCADE handles
  // profiles + btb_bests.
  let page = 1;
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      console.error('listUsers failed', error);
      process.exit(1);
    }
    const seedUsers = data.users.filter((u) =>
      u.email?.endsWith(`@${SEED_DOMAIN}`)
    );
    for (const u of seedUsers) {
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) console.error(`delete ${u.email} failed`, delErr);
      else removed++;
    }
    if (data.users.length < 200) break;
    page++;
  }
  console.log(`Removed ${removed} seed users (profiles + bests cascaded).`);
}

async function seed() {
  console.log(`Seeding ${CALLSIGNS.length} operators (@${SEED_DOMAIN})…`);
  for (let i = 0; i < CALLSIGNS.length; i++) {
    const n = i + 1;
    const callSign = CALLSIGNS[i];
    const email = `op${String(n).padStart(2, '0')}@${SEED_DOMAIN}`;
    const verified = n % 5 === 0 || n % 3 === 0;

    // Create the auth user (idempotent-ish: skip if the email already exists).
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: crypto.randomUUID(), // unknown, never used
      email_confirm: true,
      user_metadata: { seed: true },
    });

    let userId = created?.user?.id;
    if (cErr) {
      // Already exists from a prior run — look it up so the seed is re-runnable.
      if (/already.*registered|exists/i.test(cErr.message)) {
        // listUsers doesn't filter by email server-side; page to find it.
        userId = await findUserIdByEmail(email);
        if (!userId) {
          console.error(`couldn't resolve existing user ${email}`, cErr);
          continue;
        }
      } else {
        console.error(`createUser ${email} failed`, cErr);
        continue;
      }
    }
    if (!userId) continue;

    // Profile (upsert so re-runs don't error on the unique call_sign).
    const { error: pErr } = await admin.from('profiles').upsert(
      {
        id: userId,
        call_sign: callSign,
        verified,
        created_at: isoMinutesAgo(n * 60),
      },
      { onConflict: 'id' }
    );
    if (pErr) {
      console.error(`profile ${callSign} failed`, pErr);
      continue;
    }

    // Bests (upsert on the (user_id, tier) PK).
    const rows = bestsFor(n).map((b) => ({
      user_id: userId,
      tier: b.tier,
      best_copy_pct: b.best,
      bot_copy_pct_at_best: b.bot,
      updated_at: isoMinutesAgo(b.minutesAgo),
    }));
    const { error: bErr } = await admin
      .from('btb_bests')
      .upsert(rows, { onConflict: 'user_id,tier' });
    if (bErr) console.error(`bests ${callSign} failed`, bErr);

    process.stdout.write('.');
  }
  console.log(`\nSeeded. Check the leaderboard.`);
}

async function findUserIdByEmail(email: string): Promise<string | undefined> {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) return undefined;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return undefined;
    page++;
  }
}

const mode = process.argv.includes('--teardown') ? 'teardown' : 'seed';
await (mode === 'teardown' ? teardown() : seed());
