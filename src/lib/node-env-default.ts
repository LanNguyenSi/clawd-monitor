/**
 * `npm start` runs the compiled server, which must behave like production
 * (startup check, no dev fallbacks for the password and the JWT secret). npm
 * sets `npm_lifecycle_event=start` for that script, so NODE_ENV defaults to
 * `production` there. A NODE_ENV the caller set (any non-empty value, for
 * example `development`) wins; an empty one counts as unset. Any other way of
 * starting the process (`npm run dev`, `tsx server.ts`, `node dist/server.js`)
 * is left alone. Done in code rather than in the `start` script so it also works
 * on Windows shells, where `NODE_ENV=... cmd` is not valid.
 *
 * Kept in its own module, free of import side effects, so tests can import it
 * without loading any env files into their own process.
 */
export function defaultNodeEnvForStart(env: Record<string, string | undefined> = process.env): void {
  if (env.npm_lifecycle_event === 'start' && !env.NODE_ENV) {
    env.NODE_ENV = 'production'
  }
}
