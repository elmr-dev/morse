/**
 * Shared callsign database loader
 * Used by both rufzjs and contest-runner
 */

let loadedCallsigns: string[] | null = null;
let loadPromise: Promise<string[]> | null = null;
let loadError: Error | null = null;

/**
 * Load callsigns from gzipped file
 */
async function loadCallsigns(basePath: string): Promise<string[]> {
  console.log(`[Callsigns] Loading from ${basePath}/callsigns.txt.gz...`);

  const response = await fetch(`${basePath}/callsigns.txt.gz`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  // Use DecompressionStream (available in all modern browsers)
  if (!('DecompressionStream' in window)) {
    throw new Error('DecompressionStream not supported - please use a modern browser');
  }

  const ds = new DecompressionStream('gzip');
  const decompressedStream = response.body!.pipeThrough(ds);
  const text = await new Response(decompressedStream).text();
  const calls = text.trim().split('\n').filter(c => c.length >= 3 && c.length <= 10);

  if (calls.length < 1000) {
    throw new Error(`Only loaded ${calls.length} callsigns - database may be corrupt`);
  }

  console.log(`[Callsigns] Loaded ${calls.length} callsigns successfully`);
  return calls;
}

/**
 * Initialize callsign database
 * @param basePath - Base path to the callsigns.txt.gz file (default: '.' for public folder)
 * @returns Promise that resolves to the callsign array, or rejects on error
 */
export function initCallsignDatabase(basePath: string = '.'): Promise<string[]> {
  if (loadedCallsigns) {
    return Promise.resolve(loadedCallsigns);
  }
  if (loadError) {
    return Promise.reject(loadError);
  }
  if (!loadPromise) {
    loadPromise = loadCallsigns(basePath)
      .then(calls => {
        loadedCallsigns = calls;
        return calls;
      })
      .catch(err => {
        loadError = err instanceof Error ? err : new Error(String(err));
        console.error('[Callsigns] Failed to load:', loadError.message);
        throw loadError;
      });
  }
  return loadPromise;
}

/**
 * Check if the database is loaded and ready
 */
export function isCallsignDatabaseReady(): boolean {
  return loadedCallsigns !== null && loadedCallsigns.length > 1000;
}

/**
 * Get the number of loaded callsigns
 */
export function getCallsignCount(): number {
  return loadedCallsigns?.length ?? 0;
}

/**
 * Get the loaded callsigns - throws if not loaded
 */
export function getCallsigns(): string[] {
  if (!loadedCallsigns) {
    throw new Error('Callsign database not loaded - call initCallsignDatabase() first');
  }
  return loadedCallsigns;
}

/**
 * Fisher-Yates shuffle - creates a new shuffled array
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Get a random selection of unique callsigns for a game
 * Uses crypto.getRandomValues for better randomness if available
 */
export function getRandomCallsigns(count: number): string[] {
  const pool = getCallsigns();

  // Use a random starting point in the pool for additional randomness
  const randomStart = Math.floor(Math.random() * pool.length);

  // Shuffle and take the first N
  const shuffled = shuffle(pool);

  // Rotate by random start for extra randomness across runs
  const rotated = [...shuffled.slice(randomStart), ...shuffled.slice(0, randomStart)];

  return rotated.slice(0, count);
}
