import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {},
  },
  resolve: {
    alias: {
      'morse-audio': path.resolve(__dirname, 'packages/morse-audio/src'),
      'react-morse-audio': path.resolve(
        __dirname,
        'packages/react-morse-audio/src'
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./packages/morse-audio/src/test-setup.ts'],
    include: ['packages/**/src/**/*.test.ts'],
  },
});
