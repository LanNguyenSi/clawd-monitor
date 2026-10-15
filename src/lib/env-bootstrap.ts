import { loadEnvConfig } from '@next/env'

/**
 * Load `.env` / `.env.local` (and the mode-specific variants) into
 * `process.env`. Values already present in the process environment win, so
 * variables injected by Docker Compose or the shell are never overridden.
 */
export function loadServerEnv(dir: string = process.cwd(), dev: boolean = process.env.NODE_ENV !== 'production'): void {
  loadEnvConfig(dir, dev)
}

// Side effect on import: server.ts imports this module before anything that
// reads process.env at module load (agent-ws-handler, agent-registry,
// data-store), so those modules see values from the env files.
loadServerEnv()
