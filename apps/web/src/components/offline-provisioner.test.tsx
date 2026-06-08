import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadSession, toastPromiseFn, standalone, online } = vi.hoisted(() => ({
  loadSession: vi.fn(),
  toastPromiseFn: vi.fn(),
  standalone: { current: true },
  online: { current: true },
}));

vi.mock('@/inference/onnx', () => ({ loadSession: () => loadSession() }));
vi.mock('sonner', () => ({ toast: { promise: toastPromiseFn } }));
vi.mock('@/lib/use-online', () => ({ useOnline: () => online.current }));
vi.mock('@/lib/use-standalone', () => ({
  useIsStandalone: () => standalone.current,
  isStandalone: () => standalone.current,
}));

import { OfflineProvisioner } from './offline-provisioner';

function stubCaches(cached: boolean) {
  vi.stubGlobal('caches', {
    open: vi.fn().mockResolvedValue({
      match: vi.fn().mockResolvedValue(cached ? new Response('x') : undefined),
      addAll: vi.fn().mockResolvedValue(undefined),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  standalone.current = true;
  online.current = true;
  stubCaches(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OfflineProvisioner', () => {
  it('auto-saves the decoder when installed, online, and uncached', async () => {
    loadSession.mockResolvedValue({});
    render(<OfflineProvisioner />);
    await waitFor(() => expect(loadSession).toHaveBeenCalledTimes(1));
    expect(toastPromiseFn).toHaveBeenCalled();
  });

  it('does nothing in a browser tab (not installed)', async () => {
    standalone.current = false;
    render(<OfflineProvisioner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('does nothing while offline (can only fail)', async () => {
    online.current = false;
    render(<OfflineProvisioner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('does nothing when the model is already saved', async () => {
    stubCaches(true);
    render(<OfflineProvisioner />);
    await new Promise((r) => setTimeout(r, 0));
    expect(loadSession).not.toHaveBeenCalled();
    expect(toastPromiseFn).not.toHaveBeenCalled();
  });
});
