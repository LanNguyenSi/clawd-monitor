/**
 * Build the curl-pipe-bash one-liner the "Add Agent" modal hands the
 * operator. Pure function — no React, no DOM, no clipboard. Trivial to
 * unit-test once a test runner is in the repo.
 *
 * The snippet shape:
 *
 *   curl -fsSL https://raw.githubusercontent.com/LanNguyenSi/clawd-monitor-agent/master/install.sh \
 *     | sudo bash -s -- \
 *         --server <ws-or-wss URL> \
 *         --token <token> \
 *         --name <name>
 *
 * `--name` is only included when the operator typed one. The installer
 * already defaults to /etc/hostname when omitted.
 */

const INSTALL_SH_URL =
  'https://raw.githubusercontent.com/LanNguyenSi/clawd-monitor-agent/master/install.sh'

export interface BuildInstallSnippetInput {
  /**
   * The dashboard's origin (typically `window.location.origin`).
   * Either `http://...` or `https://...`. We swap the scheme to
   * `ws://` / `wss://` because that's what the agent's WebSocket
   * client expects on the wire, and it makes the operator's snippet
   * read like the production setup.
   */
  origin: string
  /** Plaintext token returned by `POST /api/settings/tokens`. */
  token: string
  /** Optional friendly name. Falls through to the agent's default if blank. */
  name?: string
}

/**
 * Translate the dashboard origin to the WebSocket origin the agent
 * connects to. Defensive about non-string / unexpected schemes —
 * returns the input unchanged when nothing matches, so a future
 * dev-tunnel scheme doesn't silently break the snippet.
 */
export function originToWs(origin: string): string {
  if (origin.startsWith('https://')) return 'wss://' + origin.slice('https://'.length)
  if (origin.startsWith('http://')) return 'ws://' + origin.slice('http://'.length)
  return origin
}

/**
 * Quote a value for safe inclusion in a `bash -s --` argument. We use
 * single quotes and escape any embedded single quotes the standard
 * shell-safe way (`'\''`). Tokens are hex so they don't need escaping
 * in practice, but a friendly name might contain spaces, apostrophes,
 * or shell metacharacters — quote everything for correctness.
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function buildInstallSnippet(input: BuildInstallSnippetInput): string {
  const server = originToWs(input.origin)
  const lines = [
    `curl -fsSL ${INSTALL_SH_URL} \\`,
    '  | sudo bash -s -- \\',
    `      --server ${shellQuote(server)} \\`,
    `      --token ${shellQuote(input.token)}`,
  ]
  if (input.name && input.name.trim().length > 0) {
    // Append a continuation slash to the previous line so the snippet
    // stays valid bash with --name on its own line.
    lines[lines.length - 1] = lines[lines.length - 1] + ' \\'
    lines.push(`      --name ${shellQuote(input.name.trim())}`)
  }
  return lines.join('\n')
}
