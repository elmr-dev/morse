/**
 * Simple callsign database loader for RufzXP trainer
 */

let loadedCallsigns: string[] | null = null;

export async function initCallsignDatabase(basePath: string = '.'): Promise<void> {
  if (loadedCallsigns) return;

  const url = `${basePath}/callsigns.txt`;
  console.log(`[Callsigns] Loading from ${url}...`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  const calls = text.trim().split('\n').filter(c => c.length >= 3 && c.length <= 10);

  if (calls.length < 1000) {
    throw new Error(`Only loaded ${calls.length} callsigns - file may be corrupt`);
  }

  loadedCallsigns = calls;
  console.log(`[Callsigns] Loaded ${calls.length} callsigns`);
}

export function isCallsignDatabaseReady(): boolean {
  return loadedCallsigns !== null && loadedCallsigns.length > 1000;
}

export function getCallsignCount(): number {
  return loadedCallsigns?.length ?? 0;
}

export function getCallsigns(): string[] {
  if (!loadedCallsigns) {
    throw new Error('Callsign database not loaded');
  }
  return loadedCallsigns;
}

// Fisher-Yates shuffle
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function getRandomCallsigns(count: number): string[] {
  const pool = getCallsigns();
  const shuffled = shuffle(pool);
  const start = Math.floor(Math.random() * shuffled.length);
  const rotated = [...shuffled.slice(start), ...shuffled.slice(0, start)];
  return rotated.slice(0, count);
}

// Convenience alias
export function getGameCallsigns(count: number): string[] {
  return getRandomCallsigns(count);
}
