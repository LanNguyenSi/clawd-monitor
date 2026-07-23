import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Node 22.4+ ships an experimental global `localStorage` (unflagged by
// default on newer Node releases, e.g. the Node 26 this was diagnosed on)
// that vitest's jsdom environment does not override: its populateGlobal
// helper only copies a jsdom-owned key onto the worker's global when that
// key is either absent from the host global or in its hardcoded allowlist
// of DOM class names, and `localStorage` is in neither. Node's own
// accessor (non-functional unless --localstorage-file is set) therefore
// shadows jsdom's real Storage implementation, and any
// `window.localStorage` access in a jsdom test throws
// "Cannot read properties of undefined (reading 'clear')"
// (see tests/unit/instance.test.ts). Disabling the flag on the worker
// processes vitest spawns restores the jsdom-backed localStorage this
// suite has always relied on. Guarded by allowedNodeEnvironmentFlags so
// this is a no-op on Node versions without the flag (e.g. CI's Node 20).
const execArgv = process.allowedNodeEnvironmentFlags.has('--no-experimental-webstorage')
  ? ['--no-experimental-webstorage']
  : []

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    execArgv,
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
