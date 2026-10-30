import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Build output is not source. `next lint` only looked at a fixed set of
  // source directories, `eslint .` also walks the repo root, where `npm run
  // build` writes dist/ and the test run writes coverage/. eslint-config-next
  // already ignores .next, out, build and next-env.d.ts.
  globalIgnores(['dist/**', 'coverage/**']),
  {
    // These effects set state on purpose: they hydrate client-only state
    // (localStorage layout and theme, which cannot be read during SSR without a
    // hydration mismatch), reset a modal on open (AddAgentModal: the reset is
    // deliberate and its cleanup also drops the in-memory token and restores
    // focus), restart a stream on source change, or mirror an SWR snapshot into
    // an accumulating history. They stay visible as warnings instead of
    // failing the lint.
    files: [
      'src/components/AddAgentModal.tsx',
      'src/components/Grid/WidgetGrid.tsx',
      'src/components/widgets/LogTailWidget.tsx',
      'src/components/widgets/MetricsWidget.tsx',
      'src/lib/theme.tsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // The "agent offline, last seen N s ago" label is derived from the current
    // clock while rendering. The value is meant to move with the clock on
    // every render (SWR refreshes every 5-15 s); freezing it in state would
    // change what the widget shows.
    files: [
      'src/components/widgets/CronWidget.tsx',
      'src/components/widgets/DockerWidget.tsx',
      'src/components/widgets/MemoryWidget.tsx',
      'src/components/widgets/MetricsWidget.tsx',
      'src/components/widgets/SessionLogWidget.tsx',
    ],
    rules: {
      'react-hooks/purity': 'warn',
    },
  },
  {
    // Full page loads after a session change (login success, logout, 401
    // expiry) are deliberate: window.location drops all client state and the
    // SWR cache and re-runs the auth check on the server, which
    // router.push() would not do. fetcher.ts is not a component, so the
    // rule's remedies (redirect() during render, useRouter().push() in an
    // event handler) do not fit. The test file asserts the href that
    // fetcher.ts sets. Kept as warnings, like the other blocks.
    files: [
      'src/app/(auth)/login/page.tsx',
      'src/app/dashboard/page.tsx',
      'src/app/settings/page.tsx',
      'src/components/Nav/UserMenu.tsx',
      'src/lib/fetcher.ts',
      'tests/unit/fetcher.test.ts',
    ],
    rules: {
      '@next/next/no-location-assign-relative-destination': 'warn',
    },
  },
])
