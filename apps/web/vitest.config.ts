import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Aliases match the runtime so tests can import via the same paths. The
  // virtual:pwa-register/react module only exists in a real Vite build (it's
  // provided by vite-plugin-pwa), so point it at a stub for resolution; tests
  // vi.mock it to drive states.
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'virtual:pwa-register/react': path.resolve(
        __dirname,
        './src/test-stubs/pwa-register.ts'
      ),
    },
  },
  test: {
    projects: [
      {
        // Inference pipeline: environment-agnostic except onnxruntime-web's
        // wasm. No DOM needed, and the first ONNX session warm-up is slow.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          testTimeout: 30000,
        },
      },
      {
        // React components: DOM + testing-library + vitest-axe.
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./src/test-setup.ts'],
        },
      },
    ],
  },
});
