import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const loadSession = vi.fn();
vi.mock('@/inference/onnx', () => ({
  loadSession: () => loadSession(),
}));

import { OfflineSection } from './offline-section';

/** Stub the Cache Storage API. `cached` controls whether assets are present. */
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
  stubCaches(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OfflineSection', () => {
  it('offers to save for off-grid use when nothing is cached', async () => {
    render(<OfflineSection />);
    expect(
      await screen.findByRole('button', { name: /off-grid/i })
    ).toBeInTheDocument();
  });

  it('downloads the model on tap and confirms it is available off-grid', async () => {
    loadSession.mockResolvedValue({});
    render(<OfflineSection />);
    await userEvent.click(
      await screen.findByRole('button', { name: /off-grid/i })
    );
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/saved for off-grid/i)).toBeInTheDocument();
  });

  it('surfaces an error and allows retry when the download fails', async () => {
    loadSession.mockRejectedValueOnce(new Error('network')); // first tap fails
    render(<OfflineSection />);
    await userEvent.click(
      await screen.findByRole('button', { name: /off-grid/i })
    );
    const retry = await screen.findByRole('button', { name: /try again/i });
    loadSession.mockResolvedValueOnce({});
    await userEvent.click(retry);
    expect(await screen.findByText(/saved for off-grid/i)).toBeInTheDocument();
  });

  it('reflects already-cached state on mount without re-downloading', async () => {
    stubCaches(true);
    render(<OfflineSection />);
    expect(await screen.findByText(/saved for off-grid/i)).toBeInTheDocument();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('does not offer to save while off-grid (it could only fail)', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });
    render(<OfflineSection />);
    expect(
      await screen.findByText(/reconnect to the internet/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save for off-grid/i })
    ).not.toBeInTheDocument();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<OfflineSection />);
    await screen.findByRole('button', { name: /off-grid/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
