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
      // Ratchet floor ~3 points below the measured baseline (2026-06-30):
      //   statements 81.27% / branches 77.24% / functions 76.08% / lines 82.19%
      // instance.ts (0%) and fetcher.ts (0%) remain uncovered and drag the
      // global % down; they are tracked as follow-up work.
      thresholds: {
        statements: 78,
        branches: 74,
        functions: 73,
        lines: 79,
      },
    },
  },
})
