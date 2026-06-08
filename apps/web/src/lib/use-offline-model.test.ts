import { afterEach, describe, expect, it, vi } from 'vitest';

// Avoid pulling in onnxruntime-web just to test the cache helper.
vi.mock('@/inference/onnx', () => ({ loadSession: vi.fn() }));

import { isOfflineModelCached } from './use-offline-model';

/** Stub Cache Storage; `present(url)` decides whether each asset is cached. */
function stubCaches(present: (url: string) => boolean) {
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({
      match: vi.fn(async (url: string) => (present(url) ? {} : undefined)),
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isOfflineModelCached', () => {
  it('is false when the Cache API is unavailable', async () => {
    vi.stubGlobal('caches', undefined);
    expect(await isOfflineModelCached()).toBe(false);
  });

  it('is true when every required asset is cached', async () => {
    stubCaches(() => true);
    expect(await isOfflineModelCached()).toBe(true);
  });

  it('is false when any required asset is missing', async () => {
    // wasm runtime present but the model absent → not usable offline.
    stubCaches((url) => !url.endsWith('.onnx'));
    expect(await isOfflineModelCached()).toBe(false);
  });
});
