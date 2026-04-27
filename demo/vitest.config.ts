import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Run in node — the inference pipeline is environment-agnostic except
    // onnxruntime-web's wasm. We don't need DOM/jsdom for these tests.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30000, // ONNX session warm-up is slow on first call
  },
  // Aliases match the runtime so tests can import via the same paths.
  resolve: {
    alias: {},
  },
})
