/**
 * Build the two-step install recipe the "Add Agent" modal and the
 * Settings page hand the operator. Pure function — no React, no DOM,
 * no clipboard. Trivial to unit-test once a test runner is in the repo.
 *
 * The recipe shape (two SEPARATE copy blocks, pasted one after the
 * other, never merged into one):
 *
 *   Step 1, paste and enter the token at the prompt:
 *
 *     printf 'Agent token: '; read -rs CLAWD_AGENT_TOKEN; echo; export CLAWD_AGENT_TOKEN
 *
 *   Step 2, run the installer:
 *
 *     curl -fsSL https://raw.githubusercontent.com/LanNguyenSi/clawd-monitor-agent/master/install.sh \
 *       | sudo --preserve-env=CLAWD_AGENT_TOKEN bash -s -- \
 *           --server <ws-or-wss URL> \
 *           --name <name>; unset CLAWD_AGENT_TOKEN
 *
 * The token is never part of the generated text: the operator types it
 * at step 1's interactive prompt (`read -rs` keeps it out of the shell
 * history) and step 2 inherits it from the shell environment through
 * `sudo --preserve-env`. Merging the steps into one paste block is a
 * bug, not a shortcut: `read -rs` consumes the NEXT pasted line, so a
 * merged block would eat the curl line as the token.
 *
 * The token reaches the installer through the environment of `sudo`,
 * never as an argument: the argv of `sudo` and `bash` is readable by
 * every local user for as long as the installer runs (`ps`,
 * `/proc/<pid>/cmdline`), the environment is readable only by root and
 * the invoking user. What stays: the token lives only in the operator's
 * interactive prompt (typed, never pasted) and in the installer's
 * process environment until the installer unsets it (before it starts
 * npm or apt); step 2 ends with `; unset CLAWD_AGENT_TOKEN` on its
 * last line so the variable does not outlive the install in the
 * operator's own shell. It is part of the same logical command, never a
 * separate pasted line: without bracketed paste, sudo would read a
 * separate `unset` line as its password and the token would stay in the
 * shell.
 * The installer reads `CLAWD_AGENT_TOKEN` from the agent repository's
 * `install.sh` on master, so this recipe needs an installer that knows
 * the variable (an older installer answers with a missing-token error
 * and changes nothing).
 *
 * If `sudo` answers "not allowed to set the following environment
 * variables" (a restricted sudoers), run the `curl ... | bash -s -- ...`
 * line from a root shell without `sudo`, or use `--token-file <path>`.
 *
 * `--name` is only included when the operator typed one. The installer
 * already defaults to /etc/hostname when omitted.
 */

/** Environment variable the agent's installer reads the token from. */
const TOKEN_ENV_VAR = 'CLAWD_AGENT_TOKEN'

const INSTALL_SH_URL =
  'https://raw.githubusercontent.com/LanNguyenSi/clawd-monitor-agent/master/install.sh'

/**
 * Step 1: read the token from the terminal into the environment. One
 * line, commands separated by `;`, so pasting it runs the printf and
 * leaves `read -rs` waiting for the typed token; `export` hands it to
 * the installer in step 2. Nothing here embeds the token.
 */
const PROMPT_STEP = `printf 'Agent token: '; read -rs ${TOKEN_ENV_VAR}; echo; export ${TOKEN_ENV_VAR}`

export interface BuildInstallSnippetInput {
  /**
   * The dashboard's origin (typically `window.location.origin`).
   * Either `http://...` or `https://...`. We swap the scheme to
   * `ws://` / `wss://` because that's what the agent's WebSocket
   * client expects on the wire, and it makes the operator's snippet
   * read like the production setup.
   */
  origin: string
  /** Optional friendly name. Falls through to the agent's default if blank. */
  name?: string
}

export interface InstallSnippetSteps {
  /** Step 1: paste, then type the token at the prompt. */
  promptStep: string
  /** Step 2: paste, run, ends with `; unset CLAWD_AGENT_TOKEN` on the last line. */
  installStep: string
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
 * shell-safe way (`'\''`). Friendly names might contain spaces,
 * apostrophes, or shell metacharacters — quote everything for
 * correctness.
 */
export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

/**
 * Build the two steps. The token is deliberately not an input: it is
 * only ever typed by the operator at step 1's prompt, so it cannot
 * leak into the generated text, the rendered page, or the shell
 * history.
 */
export function buildInstallSnippet(input: BuildInstallSnippetInput): InstallSnippetSteps {
  const server = originToWs(input.origin)
  const lines = [
    `curl -fsSL ${INSTALL_SH_URL} \\`,
    `  | sudo --preserve-env=${TOKEN_ENV_VAR} bash -s -- \\`,
    `      --server ${shellQuote(server)}`,
  ]
  if (input.name && input.name.trim().length > 0) {
    // Append a continuation slash to the previous line so the snippet
    // stays valid bash with --name on its own line.
    lines[lines.length - 1] = lines[lines.length - 1] + ' \\'
    lines.push(`      --name ${shellQuote(input.name.trim())}`)
  }
  // Same logical command, regardless of the pipeline result.
  lines[lines.length - 1] = lines[lines.length - 1] + `; unset ${TOKEN_ENV_VAR}`
  return { promptStep: PROMPT_STEP, installStep: lines.join('\n') }
}
