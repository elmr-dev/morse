import { useCallback, useEffect, useState } from 'react';
import { loadSession } from '@/inference/onnx';

// Workbox runtime caches (see vite.config.ts). The SW serves these offline; we
// fill them here directly rather than relying on the SW to intercept ORT's own
// fetches — those can be range requests (206), which Workbox won't cache, and
// on a first launch the page may not be SW-controlled yet.
const base = import.meta.env.BASE_URL;
const MODEL_CACHE = 'onnx-model';
const WASM_CACHE = 'ort-wasm';
// URLs must match what the runtime requests (src/inference/onnx.ts) and the
// files shipped in public/ — keep in sync if onnxruntime-web's assets change.
const REQUIRED: { cache: string; assets: string[] }[] = [
  { cache: MODEL_CACHE, assets: [`${base}model/cw_model_full.onnx`] },
  {
    cache: WASM_CACHE,
    assets: [
      `${base}ort/ort-wasm-simd-threaded.wasm`,
      `${base}ort/ort-wasm-simd-threaded.mjs`,
    ],
  },
];

/** Whether every required offline asset is present in the runtime caches.
 *  Lets callers (e.g. the decode page) detect an offline dead-end before
 *  attempting a load that would otherwise hang on the unreachable fetch. */
export async function isOfflineModelCached(): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const perCache = await Promise.all(
      REQUIRED.map(async ({ cache, assets }) => {
        const c = await caches.open(cache);
        const matches = await Promise.all(assets.map((url) => c.match(url)));
        return matches.every(Boolean);
      })
    );
    return perCache.every(Boolean);
  } catch {
    return false;
  }
}

/** 'checking' until the cache lookup resolves, so callers can distinguish
 *  "not cached" from "don't know yet" (avoids prompting over a cached model). */
export type OfflineStatus =
  | 'checking'
  | 'idle'
  | 'downloading'
  | 'ready'
  | 'error';

/** Provisions the decoder for offline use by populating the SW's runtime caches
 *  with full responses (cache.addAll → plain GETs → 200s), then validating the
 *  model loads. Shared by the manual More-sheet control and the automatic
 *  install-time provisioner. */
export function useOfflineModel(): {
  status: OfflineStatus;
  download: () => Promise<void>;
} {
  const [status, setStatus] = useState<OfflineStatus>('checking');

  // Reflect a prior download before doing anything — every required asset must
  // be present, so a half-finished download still reads as idle.
  useEffect(() => {
    let active = true;
    isOfflineModelCached().then((cached) => {
      if (active) setStatus(cached ? 'ready' : 'idle');
    });
    return () => {
      active = false;
    };
  }, []);

  const download = useCallback(async (): Promise<void> => {
    setStatus('downloading');
    try {
      if (typeof caches !== 'undefined') {
        await Promise.all(
          REQUIRED.map(async ({ cache, assets }) => {
            const c = await caches.open(cache);
            await c.addAll(assets);
          })
        );
      }
      // Confirm the model actually loads and warm the in-memory session.
      await loadSession();
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      throw err; // surface to toast.promise / the caller
    }
  }, []);

  return { status, download };
}
