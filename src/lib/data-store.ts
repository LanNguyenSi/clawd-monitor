import { readFileSync, writeFileSync, existsSync, mkdirSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

const DATA_DIR = process.env.CLAWD_MONITOR_DATA_DIR ?? '/data'

export function getDataDir(): string {
  if (!existsSync(DATA_DIR)) {
    try { mkdirSync(DATA_DIR, { recursive: true }) } catch {}
  }
  return DATA_DIR
}

/**
 * A data file exists but cannot be used: unreadable (EACCES, EISDIR, ...) or
 * not valid JSON (a truncated or hand-edited file, an empty file). It is
 * thrown instead of the default so that a broken store is never mistaken for
 * an empty one: the callers that rewrite a file read it first, so a default
 * returned here would be written back over the damaged file and destroy what
 * is left of it. The file is left untouched. Only a missing file (ENOENT,
 * first start) yields the default.
 */
export class DataFileError extends Error {
  readonly filename: string
  constructor(filename: string, reason: string, options?: { cause?: unknown }) {
    super(`Data file ${filename} is unusable: ${reason}. It was left untouched; repair or remove it and retry.`, options)
    this.name = 'DataFileError'
    this.filename = filename
  }
}

function errorReason(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof err.code === 'string') return `${err.code} while reading`
  if (err instanceof SyntaxError) return `not valid JSON (${err.message})`
  return err instanceof Error ? err.message : 'unknown error'
}

export function readDataFile<T>(filename: string, defaultValue: T): T {
  const path = join(getDataDir(), filename)
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return defaultValue
    throw new DataFileError(filename, errorReason(err), { cause: err })
  }
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new DataFileError(filename, errorReason(err), { cause: err })
  }
}

/** How often a temp name that already exists is replaced by a fresh random one. */
const TEMP_NAME_ATTEMPTS = 5

/**
 * Replaces the file atomically: the data goes to a temp file in the same
 * directory (same filesystem, so rename cannot degrade to a copy), is fsynced,
 * and is renamed over the target. A crash at any point leaves either the old
 * complete file or the new complete file, plus at worst a stray temp file;
 * never a truncated target. The new file is always mode 0600 (the stores hold
 * bcrypt hashes), also when the replaced file had looser permissions. The
 * function is synchronous, so two writes of one process cannot interleave.
 * The temp name carries random bytes, not a pid and counter: in a container
 * node is pid 1 on every start, so a counter-based name would be the same
 * after each restart and collide with the leftover of a crash. The temp is
 * opened with `wx`, so an existing file of that name is never written to; it
 * is skipped (new random name), and only a temp this call created is removed
 * on failure. Needs write permission on the data directory, not only on the
 * file.
 */
export function writeDataFile(filename: string, data: unknown): void {
  const dir = getDataDir()
  const path = join(dir, filename)
  let tmp = ''
  let fd: number | null = null
  for (let attempt = 1; fd === null; attempt++) {
    tmp = join(dir, `.${filename}.${randomBytes(8).toString('hex')}.tmp`)
    try {
      fd = openSync(tmp, 'wx', 0o600)
    } catch (err) {
      const exists = err && typeof err === 'object' && 'code' in err && err.code === 'EEXIST'
      // Nothing was created here, so there is nothing to clean up and the
      // file that is in the way is not ours to delete.
      if (!exists || attempt >= TEMP_NAME_ATTEMPTS) throw err
    }
  }
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2))
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    renameSync(tmp, path)
  } catch (err) {
    if (fd !== null) { try { closeSync(fd) } catch {} }
    // The temp exists here: this call created it with `wx`.
    try { unlinkSync(tmp) } catch {}
    throw err
  }
  // Make the rename itself durable; best effort, a directory cannot be
  // opened for fsync on every platform.
  try {
    const dirFd = openSync(dir, 'r')
    try { fsyncSync(dirFd) } finally { closeSync(dirFd) }
  } catch {}
}

// Token management
export interface TokenEntry {
  id: string
  name: string
  tokenHash: string   // bcrypt hash of the actual token
  createdAt: string
  lastUsedAt?: string  // ISO timestamp, set on each successful agent handshake with this token
}

export function readTokens(): TokenEntry[] {
  const tokens = readDataFile<TokenEntry[]>('tokens.json', [])
  // Valid JSON of the wrong shape (`null`, `{}`, `[null]`, an entry without a
  // string tokenHash) is as unusable as a parse error: callers iterate the
  // list, compare against each hash and write it back, and one bad entry
  // would throw outside any try in the handshake.
  if (!Array.isArray(tokens)) throw new DataFileError('tokens.json', 'not a JSON array')
  tokens.forEach((entry, i) => {
    const bad = (field: string) => new DataFileError('tokens.json', `entry ${i} has no valid ${field}`)
    if (entry === null || typeof entry !== 'object') throw new DataFileError('tokens.json', `entry ${i} is not an object`)
    for (const field of ['id', 'name', 'tokenHash', 'createdAt'] as const) {
      if (typeof entry[field] !== 'string') throw bad(field)
    }
    if (entry.lastUsedAt !== undefined && typeof entry.lastUsedAt !== 'string') throw bad('lastUsedAt')
  })
  return tokens
}

export function writeTokens(tokens: TokenEntry[]): void {
  writeDataFile('tokens.json', tokens)
}

// Password management
export interface PasswordConfig {
  hash?: string
}

export function readPasswordConfig(): PasswordConfig {
  const config = readDataFile<PasswordConfig>('password.json', {})
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new DataFileError('password.json', 'not a JSON object')
  }
  // An emptied or non-string hash must not read as "no persisted password":
  // the login would fall back to the env password (a changed password
  // silently reverts), and a non-string reaches bcrypt and throws.
  if (config.hash !== undefined && (typeof config.hash !== 'string' || config.hash === '')) {
    throw new DataFileError('password.json', 'hash is not a non-empty string')
  }
  return config
}

export function writePasswordConfig(config: PasswordConfig): void {
  writeDataFile('password.json', config)
}
