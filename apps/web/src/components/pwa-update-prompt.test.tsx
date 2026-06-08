import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

// Drive the SW registration hook by hand so we can exercise each state.
const useRegisterSW = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => useRegisterSW(),
}));

import { PwaUpdatePrompt } from './pwa-update-prompt';

const setNeedRefresh = vi.fn();
const setOfflineReady = vi.fn();
const updateServiceWorker = vi.fn();

function mockState({
  needRefresh = false,
  offlineReady = false,
}: {
  needRefresh?: boolean;
  offlineReady?: boolean;
}) {
  useRegisterSW.mockReturnValue({
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('PwaUpdatePrompt', () => {
  it('renders nothing when there is no update and not offline-ready', () => {
    mockState({});
    const { container } = render(<PwaUpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('prompts to reload when a new version is waiting', () => {
    mockState({ needRefresh: true });
    render(<PwaUpdatePrompt />);
    expect(screen.getByText(/new version/i)).toBeInTheDocument();
  });

  it('activates the new service worker when Reload is clicked', async () => {
    mockState({ needRefresh: true });
    render(<PwaUpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  });

  it('dismisses the update prompt without reloading', async () => {
    mockState({ needRefresh: true });
    render(<PwaUpdatePrompt />);
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(setNeedRefresh).toHaveBeenCalledWith(false);
    expect(updateServiceWorker).not.toHaveBeenCalled();
  });

  it('stays silent on offline-ready (only a new version prompts)', () => {
    // offlineReady fires on first SW install for every visitor; surfacing it
    // here would be misleading, so the component must not render for it.
    mockState({ offlineReady: true });
    const { container } = render(<PwaUpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no accessibility violations while prompting to reload', async () => {
    mockState({ needRefresh: true });
    const { container } = render(<PwaUpdatePrompt />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
