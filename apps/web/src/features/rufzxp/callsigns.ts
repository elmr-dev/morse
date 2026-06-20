// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

let cachedCallsigns: string[] | null = null;

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export async function loadRufzxpCallsigns(): Promise<string[]> {
  if (cachedCallsigns) return cachedCallsigns;

  const response = await fetch('/rufzxp/callsigns.txt');
  if (!response.ok) {
    throw new Error(`Unable to load RufZXP callsigns (${response.status})`);
  }

  const text = await response.text();
  const callsigns = text
    .split(/\r?\n/)
    .map((call) => call.trim().toUpperCase())
    .filter((call) => call.length >= 3 && call.length <= 10);

  if (callsigns.length < 1000) {
    throw new Error('RufZXP callsign database is incomplete');
  }

  cachedCallsigns = callsigns;
  return callsigns;
}

export function pickRufzxpCallsigns(pool: string[], count: number): string[] {
  return shuffle(pool).slice(0, count);
}
