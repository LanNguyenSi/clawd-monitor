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
      include: [
        'src/lib/**/*.ts',
        'src/app/api/auth/change-password/route.ts',
        // '[id]' is a glob char-class, so a literal segment won't match the
        // dynamic-route directory — use '**' to cover both tokens/route.ts
        // and tokens/[id]/route.ts.
        'src/app/api/settings/tokens/**/route.ts',
      ],
      // Ratchet floor ~3 points below the measured baseline (2026-07-14):
      //   statements 99.4% / branches 95.19% / functions 98.14% / lines 99.31%
      // instance.ts and fetcher.ts are now covered under jsdom (see
      // tests/unit/instance.test.ts and tests/unit/fetcher.test.ts).
      thresholds: {
        statements: 96,
        branches: 92,
        functions: 95,
        lines: 96,
        'src/app/api/auth/change-password/route.ts': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'src/app/api/settings/tokens/route.ts': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
        'src/app/api/settings/tokens/[id]/route.ts': {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
})
