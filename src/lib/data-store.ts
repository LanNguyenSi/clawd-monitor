import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = process.env.CLAWD_MONITOR_DATA_DIR ?? '/data'

export function getDataDir(): string {
  if (!existsSync(DATA_DIR)) {
    try { mkdirSync(DATA_DIR, { recursive: true }) } catch {}
  }
  return DATA_DIR
}

export function readDataFile<T>(filename: string, defaultValue: T): T {
  const path = join(getDataDir(), filename)
  try {
    if (!existsSync(path)) return defaultValue
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return defaultValue
  }
}

export function writeDataFile(filename: string, data: unknown): void {
  const path = join(getDataDir(), filename)
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
}

// Password management
export interface PasswordConfig {
  hash?: string        // bcrypt hash
  plaintext?: string   // dev fallback (plaintext)
}

export function readPasswordConfig(): PasswordConfig {
  return readDataFile<PasswordConfig>('password.json', {})
}

export function writePasswordConfig(config: PasswordConfig): void {
  writeDataFile('password.json', config)
}
