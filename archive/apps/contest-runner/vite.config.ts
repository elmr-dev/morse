import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  base: '/morse-audio/apps/contest-runner/',
  resolve: {
    alias: {
      'morse-audio': path.resolve(__dirname, '../../packages/morse-audio/src'),
      'react-morse-audio': path.resolve(
        __dirname,
        '../../packages/react-morse-audio/src'
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
