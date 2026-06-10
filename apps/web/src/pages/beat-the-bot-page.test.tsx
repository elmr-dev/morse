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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import type { DualDecodeResult } from '../inference/dual-decode';

// The round always copies W1AW (truth) — a real US call so callsignCountry
// resolves and the CER/beatCount math is predictable.
const TRUTH = 'W1AW';

const { loadSession, decodeDual, fireConfetti, randomCallsign, generateAudio } =
  vi.hoisted(() => ({
    loadSession: vi.fn(),
    decodeDual: vi.fn(),
    fireConfetti: vi.fn(),
    randomCallsign: vi.fn(() => 'W1AW'),
    generateAudio: vi.fn(() => ({
      dataUri: 'data:audio/wav;base64,AAAA',
      sampleRate: 22050,
    })),
  }));

vi.mock('@/inference/onnx', () => ({ loadSession: () => loadSession() }));
vi.mock('../inference/dual-decode', () => ({
  decodeDualCallsignDataUri: (...args: unknown[]) => decodeDual(...args),
}));
vi.mock('../inference/generate', () => ({
  generateAudio: () => generateAudio(),
}));
vi.mock('../inference/callsign', async (orig) => {
  const actual = await orig<typeof import('../inference/callsign')>();
  return { ...actual, randomCallsign: () => randomCallsign() };
});
vi.mock('@/lib/confetti', () => ({ fireConfetti: () => fireConfetti() }));

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
  const result = render(<BeatTheBotPage />);
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
    // Armed: chips + play button.
    expect(screen.getByText('WPM')).toBeInTheDocument();
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

  it('increments beatCount only on strict userCER < botCER', async () => {
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

  it('records bestCER after first submission', async () => {
    decodeDual.mockResolvedValue(botResult('XXXX'));
    await renderArmed();
    await play();
    await submit(TRUTH); // userCER = 0

    await screen.findByText(/New best at/); // isNewBest=true on first round
    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('morse:btb:bests') ?? '{}'
      );
      expect(stored.technician.bestCER).toBe(0);
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
});
