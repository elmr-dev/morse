import path from 'node:path';
import react from '@vitejs/plugin-react';
import type { TestProjectConfiguration } from 'vitest/config';

// Shared web project definitions, consumed both by the standalone
// apps/web/vitest.config.ts (Turbo runs vitest from this directory) and by the
// repo-root vitest.config.ts (so `vitest <file>` from the root — e.g. Zed's
// gutter runner — routes each file to the right project). When referenced from
// the root, a project config file's own nested `projects` is ignored, so these
// must be flat, self-contained projects with an absolute `root`.

const root = __dirname;

// Aliases match the runtime so tests can import via the same paths. The
// virtual:pwa-register/react module only exists in a real Vite build (it's
// provided by vite-plugin-pwa), so point it at a stub for resolution; tests
// vi.mock it to drive states.
const shared = {
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      'virtual:pwa-register/react': path.resolve(
        root,
        'src/test-stubs/pwa-register.ts'
      ),
    },
  },
};

export const webProjects: TestProjectConfiguration[] = [
  {
    // Inference pipeline: environment-agnostic except onnxruntime-web's wasm.
    // No DOM needed, and the first ONNX session warm-up is slow.
    ...shared,
    test: {
      name: 'web:node',
      root,
      environment: 'node',
      include: ['src/**/*.test.ts'],
      testTimeout: 30000,
    },
  },
  {
    // React components: DOM + testing-library + vitest-axe.
    ...shared,
    test: {
      name: 'web:dom',
      root,
      environment: 'happy-dom',
      include: ['src/**/*.test.tsx'],
      setupFiles: [path.resolve(root, 'src/test-setup.ts')],
    },
  },
];
