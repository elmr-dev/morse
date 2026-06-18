// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { DualDecodeResult } from '../inference/dual-decode';
import type { PipelineResult } from '../inference/pipeline';

// The round always copies W1AW (truth) — a real US call so callsignCountry
// resolves and the CER/beatCount math is predictable.
const TRUTH = 'W1AW';
// Fixed random-mode copy (short, so it clears the clip-budget cap on the first
// try) for deterministic random-round assertions.
const RANDOM_TRUTH = 'CQ TEST';

const {
  loadSession,
  decodeDual,
  decodeSingle,
  fireConfetti,
  randomCallsign,
  randomCwMessage,
  generateAudio,
} = vi.hoisted(() => ({
  loadSession: vi.fn(),
  decodeDual: vi.fn(),
  decodeSingle: vi.fn(),
  fireConfetti: vi.fn(),
  randomCallsign: vi.fn(() => 'W1AW'),
  randomCwMessage: vi.fn(() => 'CQ TEST'),
  generateAudio: vi.fn(() => ({
    dataUri: 'data:audio/wav;base64,AAAA',
    sampleRate: 22050,
  })),
}));

vi.mock('@/inference/onnx', () => ({ loadSession: () => loadSession() }));
vi.mock('../inference/dual-decode', () => ({
  decodeDualCallsignDataUri: (...args: unknown[]) => decodeDual(...args),
}));
vi.mock('../inference/pipeline', () => ({
  decodeDataUri: (...args: unknown[]) => decodeSingle(...args),
}));
vi.mock('../inference/generate', () => ({
  generateAudio: () => generateAudio(),
}));
vi.mock('../inference/callsign', async (orig) => {
  const actual = await orig<typeof import('../inference/callsign')>();
  return { ...actual, randomCallsign: () => randomCallsign() };
});
vi.mock('@/lib/cw-message', () => ({
  randomCwMessage: () => randomCwMessage(),
  MAX_CW_MESSAGE: 40,
}));
vi.mock('@/lib/confetti', () => ({ fireConfetti: () => fireConfetti() }));
vi.mock('@/lib/use-bests-sync', () => ({
  useBestsSync: () => ({ syncNow: () => {} }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    status: 'signed-out',
    session: null,
    user: null,
    profile: null,
    signIn: () => Promise.resolve(),
    signOut: () => Promise.resolve(),
    claimCallsign: () => Promise.resolve({ ok: true }),
    refreshProfile: () => Promise.resolve(),
  }),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: null,
  isAuthConfigured: false,
}));

import BeatTheBotPage from './beat-the-bot-page';

function botResult(text: string): DualDecodeResult {
  const half = { text, confidence: 0.9, indices: [] };
  return {
    text,
    confidence: 0.9,
    indices: [],
    firstHalf: half,
    secondHalf: half,
    agreement: true,
    splitFrame: 0,
    envelopeBars: [0.2, 0.6, 0.4, 0.8, 0.3],
  };
}

function singleResult(text: string): PipelineResult {
  return {
    text,
    confidence: 0.9,
    timing: { audioMs: 0, dspMs: 0, modelMs: 0, decodeMs: 0, totalMs: 0 },
    envelopeBars: [0.2, 0.6, 0.4, 0.8, 0.3],
  };
}

// happy-dom's localStorage here is a partial stub (no clear/removeItem), so
// swap in a real in-memory Storage per test for isolated persisted-state reads.
function stubLocalStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, String(v)),
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  });
}

function stubMatchMedia(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLocalStorage();
  loadSession.mockResolvedValue({});
  decodeDual.mockResolvedValue(botResult('XXXX'));
  decodeSingle.mockResolvedValue(singleResult('YYYY'));
  randomCwMessage.mockReturnValue(RANDOM_TRUTH);
  // Default to reduced motion so the staged reveal resolves synchronously
  // (typing/racing skipped) — individual tests can opt back into animation.
  stubMatchMedia(true);
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Wait for loadSession so the play button enables.
async function renderArmed() {
  const result = render(
    <MemoryRouter>
      <BeatTheBotPage />
    </MemoryRouter>
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Play the signal once')).toBeEnabled()
  );
  return result;
}

async function play() {
  fireEvent.click(screen.getByLabelText('Play the signal once'));
  await screen.findByLabelText('Your copy');
}

async function submit(copy: string) {
  fireEvent.change(screen.getByLabelText('Your copy'), {
    target: { value: copy },
  });
  fireEvent.click(screen.getByRole('button', { name: /submit/i }));
}

describe('BeatTheBotPage', () => {
  it('keeps the bot copy sealed (not in the DOM) during the copying phase', async () => {
    // Bot decodes the truth exactly; if it leaked it would be on screen.
    decodeDual.mockResolvedValue(botResult(TRUTH));
    const { container } = await renderArmed();
    await play();
    // The decode resolves in the background, but its text must never render.
    await waitFor(() => expect(decodeDual).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(TRUTH)).toBeNull();
    expect(container.textContent).not.toContain(TRUTH);
    expect(
      screen.getByText('Copy sealed until you submit')
    ).toBeInTheDocument();
  });

  it('holds "copying" until the clip ends, then locks (not when decode resolves)', async () => {
    decodeDual.mockResolvedValue(botResult(TRUTH));
    const { container } = await renderArmed();
    await play();
    // Decode has resolved, but the lock waits for the transmission to finish.
    await waitFor(() => expect(decodeDual).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Bot is copying the signal…')).toBeInTheDocument();
    expect(screen.queryByText('Bot has locked its copy')).toBeNull();
    // Clip finishes → now it locks.
    const audioEl = container.querySelector('audio');
    if (!audioEl) throw new Error('audio element missing');
    fireEvent(audioEl, new Event('ended'));
    await screen.findByText('Bot has locked its copy');
  });

  it('walks armed → copying → reveal → next round', async () => {
    await renderArmed();
    // Armed: YOU/BOT spec lines + play button.
    expect(screen.getAllByText('WPM').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/One listen — close the gap on/)
    ).toBeInTheDocument();

    await play();
    // Copying: the play button is gone (one listen) and the copy field is live.
    expect(screen.queryByLabelText('Play the signal once')).toBeNull();
    expect(screen.getByLabelText('Your copy')).toBeInTheDocument();

    await submit(TRUTH);
    // Reveal: callsign + country unmasked, gap block visible.
    await screen.findByText(
      /New best at|You out-copied the bot|You matched the bot|You \d+%/
    );
    expect(screen.getByText(TRUTH)).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /another round/i }));
    // Back to armed: play button returns, copy field gone.
    await waitFor(() =>
      expect(screen.getByLabelText('Play the signal once')).toBeInTheDocument()
    );
    expect(screen.queryByLabelText('Your copy')).toBeNull();
  });

  it('generates two clips per round — one eased for the human, one hard for the bot', async () => {
    await renderArmed();
    // randomRound calls generateAudio twice: human clip + bot clip.
    expect(generateAudio).toHaveBeenCalledTimes(2);
  });

  it('fires confetti on a new personal best', async () => {
    decodeDual.mockResolvedValue(botResult('XXXX')); // bot misses → botCER > 0
    await renderArmed();
    await play();
    await submit(TRUTH); // perfect copy → userCER = 0, new best (prev was null)

    await screen.findByText(/New best at/); // isNewBest=true on first round
    expect(fireConfetti).toHaveBeenCalledTimes(1);
  });

  it('does not fire confetti when the score is not a personal best', async () => {
    // First round: perfect copy, bestCER set to 0.
    decodeDual.mockResolvedValue(botResult('XXXX'));
    await renderArmed();
    await play();
    await submit(TRUTH);
    await screen.findByText(/New best at/); // isNewBest=true on first round
    expect(fireConfetti).toHaveBeenCalledTimes(1);

    // Second round: perfect copy again — userCER = 0 = bestCER, not strictly less.
    fireEvent.click(screen.getByRole('button', { name: /another round/i }));
    await waitFor(() =>
      expect(screen.getByLabelText('Play the signal once')).toBeEnabled()
    );
    await play();
    await submit(TRUTH);
    await screen.findByText(/You out-copied the bot/);
    expect(fireConfetti).toHaveBeenCalledTimes(1); // no additional confetti
  });

  it('increments beatCount only on strict userCopyPct > botCopyPct', async () => {
    decodeDual.mockResolvedValue(botResult('XXXX')); // bot misses → botCER > 0
    await renderArmed();
    await play();
    await submit(TRUTH); // perfect copy → userCER = 0 < botCER

    await screen.findByText(/New best at/); // isNewBest=true on first round
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('morse:btb:bests') ?? '{}'
      );
      expect(stored.technician.beatCount).toBe(1);
    });
  });

  it('does not increment beatCount on a perfect tie (userCER === 0, botCER === 0)', async () => {
    decodeDual.mockResolvedValue(botResult(TRUTH)); // bot also copies perfectly
    await renderArmed();
    await play();
    await submit(TRUTH); // userCER = 0, botCER = 0 — tie, not a beat

    await screen.findByText(/New best at/); // isNewBest=true on first round (bestCER was null)
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('morse:btb:bests') ?? '{}'
      );
      expect(stored.technician.beatCount).toBe(0);
    });
  });

  it('records bestCopyPct after first submission', async () => {
    decodeDual.mockResolvedValue(botResult('XXXX'));
    await renderArmed();
    await play();
    await submit(TRUTH); // perfect copy → 100%

    await screen.findByText(/New best at/); // isNewBest=true on first round
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('morse:btb:bests') ?? '{}'
      );
      expect(stored.technician.bestCopyPct).toBe(100);
      // Bot's copy % is frozen alongside the best from THAT round.
      expect(stored.technician.botCopyPctAtBest).toBe(0);
      // Untouched tiers keep botCopyPctAtBest null.
      expect(stored['no-code'].botCopyPctAtBest).toBeNull();
    });
  });

  it('stops the audio the moment the player submits', async () => {
    await renderArmed();
    await play();
    const pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause');
    await submit(TRUTH);
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('submits on Enter', async () => {
    await renderArmed();
    await play();
    const input = screen.getByLabelText('Your copy');
    fireEvent.change(input, { target: { value: TRUTH } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText(
      /New best at|You out-copied the bot|You matched the bot|You \d+%/
    );
  });

  it('never shows an accuracy bar above 100%', async () => {
    // Over-long garbage guess would have produced >100% under the old metric.
    decodeDual.mockResolvedValue(botResult('XXXXXXXXXXXX'));
    const { container } = await renderArmed();
    await play();
    await submit('W1AWZZZZZZZZ');
    await screen.findByText(
      /New best at|You out-copied the bot|You matched the bot|You \d+%/
    );
    const pcts = Array.from(container.querySelectorAll('span'))
      .map((s) => s.textContent?.trim() ?? '')
      .filter((t) => /^\d+%$/.test(t))
      .map((t) => parseInt(t, 10));
    expect(pcts.length).toBeGreaterThan(0);
    for (const p of pcts) expect(p).toBeLessThanOrEqual(100);
  });

  describe('accessibility (no axe violations)', () => {
    it('armed', async () => {
      const { container } = await renderArmed();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('copying', async () => {
      const { container } = await renderArmed();
      await play();
      expect(await axe(container)).toHaveNoViolations();
    });

    it('reveal', async () => {
      const { container } = await renderArmed();
      await play();
      await submit(TRUTH);
      await screen.findByText(
        /New best at|You out-copied the bot|You matched the bot|You \d+%/
      );
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  it('renders the full reveal immediately under reduced motion', async () => {
    // Already in reduced motion (default). The gap block + final bars appear
    // with no timer advance — proving the non-animated path applies the result.
    decodeDual.mockResolvedValue(botResult('XXXX'));
    await renderArmed();
    await play();
    await submit(TRUTH);
    expect(
      await screen.findByText(/New best at/) // isNewBest=true on first round
    ).toBeInTheDocument();
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0); // user bar at full
  });

  it('never shows the string "CER" in the rendered output', async () => {
    decodeDual.mockResolvedValue(botResult('XXXX'));
    const { container } = await renderArmed();
    await play();
    await submit(TRUTH);
    await screen.findByText(
      /New best at|You out-copied the bot|You matched the bot|You \d+%/
    );
    expect(container.textContent).not.toContain('CER');
  });

  describe('callsign / random text mode', () => {
    it('offers a single-select toggle defaulting to Callsigns', async () => {
      await renderArmed();
      const group = screen.getByRole('radiogroup', { name: 'Round text' });
      expect(group).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Callsigns' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Random' })).not.toBeChecked();
      // Callsign mode keys twice; the chip says so.
      expect(screen.getByText('2X')).toBeInTheDocument();
    });

    it('selecting Random re-arms a single-send round (no KEYED 2X chip, mode-specific helper)', async () => {
      await renderArmed();
      fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
      expect(screen.getByRole('radio', { name: 'Random' })).toBeChecked();
      expect(
        screen.getByRole('radio', { name: 'Callsigns' })
      ).not.toBeChecked();
      // Keyed once → no 2X chip; helper reflects the active mode.
      expect(screen.queryByText('2X')).toBeNull();
      expect(screen.getByText(/Random groups/)).toBeInTheDocument();
    });

    it('persists the choice under morse:btb:textmode', async () => {
      await renderArmed();
      fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
      await waitFor(() =>
        expect(localStorage.getItem('morse:btb:textmode')).toBe('"random"')
      );
    });

    it('a random round single-decodes (no dual look) and omits the country', async () => {
      const { container } = await renderArmed();
      fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
      await play();
      await submit(RANDOM_TRUTH);
      await screen.findByText(
        /New best at|You out-copied the bot|You matched the bot|You \d+%/
      );
      // Single decode ran; the dual-look path did not.
      expect(decodeSingle).toHaveBeenCalled();
      expect(decodeDual).not.toHaveBeenCalled();
      // Truth shown (word breaks render as subtle dots between groups), but no
      // country/region pill for a random group.
      expect(container.textContent).toContain('CQ');
      expect(container.textContent).toContain('TEST');
      expect(screen.queryByText('United States')).toBeNull();
      expect(screen.queryByText('International')).toBeNull();
    });

    it('grades a random round letters-only — word gaps count for neither side', async () => {
      // Bot copies the letters perfectly but, like the model, emits no space.
      decodeSingle.mockResolvedValue(singleResult('CQTEST'));
      const { container } = await renderArmed();
      fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
      await play();
      // Human types the copy WITH the word break.
      await submit('CQ TEST');
      await screen.findByText(/New best at|You matched the bot/);
      // Both sides scored 100% — neither penalized for the gap in "CQ TEST".
      const pcts = Array.from(container.querySelectorAll('span'))
        .map((s) => s.textContent?.trim() ?? '')
        .filter((t) => /^\d+%$/.test(t))
        .map((t) => parseInt(t, 10));
      expect(pcts.length).toBeGreaterThan(0);
      expect(pcts.every((p) => p === 100)).toBe(true);
    });

    it('a random round drops the two-looks panel for a single-send disclosure', async () => {
      await renderArmed();
      fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
      await play();
      await submit(RANDOM_TRUTH);
      await screen.findByText(
        /New best at|You out-copied the bot|You matched the bot|You \d+%/
      );
      expect(screen.getByText('What you were up against')).toBeInTheDocument();
      expect(screen.queryByText('How the bot got two looks')).toBeNull();
    });

    it('scores a random round into the same per-tier best (no new storage key)', async () => {
      await renderArmed();
      fireEvent.click(screen.getByRole('radio', { name: 'Random' }));
      await play();
      await submit(RANDOM_TRUTH); // perfect copy → bestCER 0 at the active tier
      await screen.findByText(/New best at/);
      await waitFor(() => {
        const stored = JSON.parse(
          localStorage.getItem('morse:btb:bests') ?? '{}'
        );
        expect(stored.technician.bestCopyPct).toBe(100);
      });
      // No mode-dimensioned best key was introduced.
      expect(localStorage.getItem('morse:btb:bests:random')).toBeNull();
    });
  });
});
