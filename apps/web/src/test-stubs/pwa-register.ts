// Resolution stub for the `virtual:pwa-register/react` module, which only
// exists during a real Vite build (provided by vite-plugin-pwa). The vitest
// config aliases the virtual specifier here so the module graph resolves;
// tests vi.mock it to drive the service-worker states.
export function useRegisterSW(): {
  needRefresh: [boolean, (v: boolean) => void];
  offlineReady: [boolean, (v: boolean) => void];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  return {
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  };
}
