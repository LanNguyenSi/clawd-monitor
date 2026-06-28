import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      // Ratchet floor a few points below the current measured baseline so the
      // suite passes today but a regression fails CI. Raise as more libs gain
      // tests (data-store.ts, schemas.ts, gatewayFetch are still uncovered).
      thresholds: {
        statements: 58,
        branches: 55,
        functions: 45,
        lines: 58,
      },
    },
  },
})
