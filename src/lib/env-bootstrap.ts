import { loadEnvConfig } from '@next/env'

/**
 * `npm start` runs the compiled server, which must behave like production
 * (startup check, no dev fallbacks for the password and the JWT secret). npm
 * sets `npm_lifecycle_event=start` for that script, so NODE_ENV defaults to
 * `production` there. A NODE_ENV the caller set (any non-empty value, for
 * example `development`) wins; an empty one counts as unset. Any other way of
 * starting the process (`npm run dev`, `tsx server.ts`, `node dist/server.js`)
 * is left alone. Done here rather than in the `start` script so it also works
 * on Windows shells, where `NODE_ENV=... cmd` is not valid.
 */
export function defaultNodeEnvForStart(env: Record<string, string | undefined> = process.env): void {
  if (env.npm_lifecycle_event === 'start' && !env.NODE_ENV) {
    env.NODE_ENV = 'production'
  }
}

/**
 * Load `.env` / `.env.local` (and the mode-specific variants) into
 * `process.env`. Values already present in the process environment win over
 * the files. When the same key is also in a file, `@next/env` still expands a
 * `$` in the process value (dotenv-expand); escape it as `\$`.
 */
export function loadServerEnv(dir: string = process.cwd(), dev: boolean = process.env.NODE_ENV !== 'production'): void {
  loadEnvConfig(dir, dev)
}

// Side effect on import (NODE_ENV first, it picks which .env files load): server.ts imports this module before anything that
// reads process.env at module load (agent-ws-handler, agent-registry,
// data-store), so those modules see values from the env files.
defaultNodeEnvForStart()
loadServerEnv()
