import { defineConfig } from 'vitest/config';
import { webProjects } from './apps/web/vitest.projects';

// Root config so `vitest <file>` from the repo root (Zed's gutter runner, bare
// `vitest`) routes each file to the correctly-configured project. Per-package
// configs still own `turbo test`, which runs vitest from inside each package.
export default defineConfig({
  test: {
    projects: [
      'packages/morse-audio/vitest.config.ts', // flat node config — safe to reference
      ...webProjects, // web node + dom, defined flat
    ],
  },
});
