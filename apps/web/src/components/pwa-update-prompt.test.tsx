// SPDX-FileCopyrightText: 2026 Mark Percival, John Schult
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drive the SW registration hook by hand so we can exercise each state.
const useRegisterSW = vi.fn();
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (opts?: unknown) => useRegisterSW(opts),
}));

// Capture toast.custom() calls — both phases of the prompt render via
// toast.custom so we can swap the inner DOM in place without losing the
// dark Sonner card or producing a nested-toast effect.
const toastDismiss = vi.fn();
const toastCustom = vi.fn<
  (render: () => ReactElement, opts?: unknown) => string
>(() => 'toast-id-custom');
vi.mock('sonner', () => ({
  toast: Object.assign(
    () => {
      throw new Error('regular toast() should not be used by the prompt');
    },
    {
      dismiss: (id?: string | number) => toastDismiss(id),
      custom: (render: () => ReactElement, opts?: unknown) =>
        toastCustom(render, opts),
    }
  ),
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
  it('does not surface a toast when there is no update', () => {
    mockState({});
    const { container } = render(<PwaUpdatePrompt />);
    expect(container).toBeEmptyDOMElement();
    expect(toastCustom).not.toHaveBeenCalled();
  });

  it('renders the prompt via toast.custom when a new version is waiting', () => {
    mockState({ needRefresh: true });
    render(<PwaUpdatePrompt />);
    expect(toastCustom).toHaveBeenCalledTimes(1);
    const [renderFn, opts] = toastCustom.mock.calls[0]!;
    expect((opts as { duration: number }).duration).toBe(
      Number.POSITIVE_INFINITY
    );
    // Render-function output carries the "Update available" copy.
    const node = renderFn();
    const tree = JSON.stringify(node);
    expect(tree).toMatch(/Update available/);
  });

  it('stays silent on offline-ready (only a new version prompts)', () => {
    mockState({ offlineReady: true });
    render(<PwaUpdatePrompt />);
    expect(toastCustom).not.toHaveBeenCalled();
  });

  it('soft-snoozes on Not now: hides the toast without clearing needRefresh', () => {
    mockState({ needRefresh: true });
    render(<PwaUpdatePrompt />);
    // The Not now button's onClick is buried in the render-function output.
    // Snapshot the rendered tree once, then dig out the snooze handler.
    const node = toastCustom.mock.calls[0]![0]() as ReactElement;
    const onSnooze = findOnClick(node, 'Not now');
    expect(onSnooze).toBeTruthy();
    act(() => onSnooze!());
    // Dismiss must not retire the underlying flag — otherwise the next
    // visibility flip can't re-surface the prompt for the still-waiting SW.
    expect(setNeedRefresh).not.toHaveBeenCalled();
    expect(updateServiceWorker).not.toHaveBeenCalled();
    expect(toastDismiss).toHaveBeenCalled();
  });

  it('re-shows the toast on next visibility → visible after a Not now', () => {
    mockState({ needRefresh: true });
    render(<PwaUpdatePrompt />);
    const node = toastCustom.mock.calls[0]![0]() as ReactElement;
    const onSnooze = findOnClick(node, 'Not now');
    act(() => onSnooze!());
    toastCustom.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(toastCustom).toHaveBeenCalled();
  });

  it('activates the new SW when Update is tapped', () => {
    mockState({ needRefresh: true });
    updateServiceWorker.mockResolvedValue(undefined);
    render(<PwaUpdatePrompt />);
    const node = toastCustom.mock.calls[0]![0]() as ReactElement;
    const onUpdate = findOnClick(node, 'Update');
    act(() => onUpdate!());
    // We drive the reload ourselves after the success beat, so the SW is
    // activated WITHOUT vite-plugin-pwa's auto-reload.
    expect(updateServiceWorker).toHaveBeenCalledWith(false);
  });

  it('swaps to the "Updated to vX" success state before reloading', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ version: '9.9.9' }),
      } as Response)
    );
    vi.stubGlobal('fetch', fetchMock);
    mockState({ needRefresh: true });
    updateServiceWorker.mockResolvedValue(undefined);
    render(<PwaUpdatePrompt />);
    const node = toastCustom.mock.calls[0]![0]() as ReactElement;
    const onUpdate = findOnClick(node, 'Update');
    await act(async () => {
      onUpdate!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    // Reload waits for the dwell, not the SW activation.
    expect(reload).not.toHaveBeenCalled();
    // Latest toast.custom render now produces the success copy with the
    // version fetched from the new SW's precached manifest.
    const doneNode = toastCustom.mock.calls.at(-1)![0]() as ReactElement;
    const doneTree = JSON.stringify(doneNode);
    expect(doneTree).toMatch(/Updated/);
    expect(doneTree).toMatch(/v9\.9\.9/);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('polls for updates and listens for visibility changes once registered', () => {
    mockState({});
    const setInterval = vi.spyOn(window, 'setInterval');
    const addListener = vi.spyOn(document, 'addEventListener');
    render(<PwaUpdatePrompt />);
    const opts = useRegisterSW.mock.calls[0]![0] as {
      onRegisteredSW: (
        url: string,
        registration: ServiceWorkerRegistration
      ) => void;
    };
    const registration = {
      installing: null,
      update: vi.fn(),
    } as unknown as ServiceWorkerRegistration;
    opts.onRegisteredSW('/sw.js', registration);
    expect(setInterval).toHaveBeenCalled();
    expect(addListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function)
    );
  });
});

/** Walk a rendered React node looking for an element whose children
 *  include the given text, and return its onClick (typed as a thunk). */
function findOnClick(
  node: ReactElement | unknown,
  label: string
): (() => void) | null {
  if (
    !node ||
    typeof node !== 'object' ||
    !('props' in (node as { props?: unknown }))
  ) {
    return null;
  }
  const el = node as ReactElement & {
    props: { children?: unknown; onClick?: () => void };
  };
  const children = el.props.children;
  if (typeof children === 'string' && children === label) {
    return el.props.onClick ?? null;
  }
  if (Array.isArray(children)) {
    for (const child of children) {
      const hit = findOnClick(child, label);
      if (hit) return hit;
    }
  } else if (children) {
    return findOnClick(children, label);
  }
  return null;
}
