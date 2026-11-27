'use client'

import { useEffect, useRef, useState } from 'react'
import { buildInstallSnippet } from '@/lib/install-snippet'

interface Props {
  open: boolean
  onClose: () => void
  /** Optional callback fired after a successful token generation. */
  onTokenCreated?: () => void
}

type Step = 'name' | 'snippet'

/** Focusable descendants of the dialog, in tab order (WCAG 2.4.3). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * "Add Agent" modal. Two steps:
 *
 *   1. Operator types a friendly name and hits Generate. We POST
 *      /api/settings/tokens (existing route, unchanged) which returns
 *      the plaintext token *once* + the row's id and name.
 *
 *   2. We render the token in its own copy box (shown once, then
 *      unrecoverable) plus two separate paste blocks: step 1 reads the
 *      token at an interactive prompt, step 2 runs the installer with
 *      the token inherited from the shell environment and ends with
 *      `unset CLAWD_AGENT_TOKEN`. The token is never part of the
 *      generated commands, so it never lands in the operator's shell
 *      history. The two steps must stay separate copy blocks: pasted
 *      as one block, `read -rs` would consume the curl line as the
 *      token.
 *
 * Token-handling rules enforced here:
 * - The plaintext token never leaves React state. We clear it on
 *   close AND on next open, in case the parent keeps the modal
 *   mounted with `open=false`.
 * - On step 2, dismissive interactions (backdrop click, Esc) are
 *   disabled. The operator MUST click Done — every other path would
 *   destroy a token they may not have copied yet.
 * - Focus is captured on open, restored on close, moved to the Copy
 *   button when the token first appears.
 */
export function AddAgentModal({ open, onClose, onTokenCreated }: Props) {
  const [step, setStep] = useState<Step>('name')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped on every submit so the error paragraph can be keyed by it:
  // a second failed submit with the same message remounts the alert
  // instead of writing identical text into the same node, which
  // assistive technology would not announce again.
  const [attempt, setAttempt] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [tokenName, setTokenName] = useState<string>('')
  const [copied, setCopied] = useState<'token' | 'step1' | 'step2' | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const tokenCopyButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<Element | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Reset all state when the modal opens; capture the previously
  // focused element so we can restore it on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement
      setStep('name')
      setName('')
      setSubmitting(false)
      setError(null)
      setToken(null)
      setTokenName('')
      setCopied(null)
      // Defer focus until after the modal has painted.
      requestAnimationFrame(() => nameInputRef.current?.focus())
      return () => {
        // Drop the in-memory token on close. The reset on next open
        // already does this, but if a parent test-renders the modal
        // with `open=false` after a close-without-reopen, we don't
        // want a stale token sitting in state.
        setToken(null)
        setTokenName('')
        // Restore focus to wherever the operator was before opening.
        if (
          previousFocusRef.current instanceof HTMLElement &&
          document.body.contains(previousFocusRef.current)
        ) {
          previousFocusRef.current.focus()
        }
      }
    }
  }, [open])

  // When step transitions to 'snippet', move focus to the token's
  // Copy button so screen readers land on the actionable element
  // (after announcing the dialog title via aria-labelledby).
  useEffect(() => {
    if (step === 'snippet' && token !== null) {
      requestAnimationFrame(() => tokenCopyButtonRef.current?.focus())
    }
  }, [step, token])

  // Esc closes — but only on the name step. On the snippet step the
  // token is unrecoverable, so we require an explicit Done click.
  //
  // The same window listener runs the focus trap (WCAG 2.4.3): Tab
  // from the last focusable control wraps to the first, Shift+Tab
  // from the first wraps to the last, and either one with focus
  // outside the dialog's focusable set (a click on the backdrop or on
  // a non-focusable spot inside the panel parks focus on <body>)
  // moves focus into the dialog instead of onward into the page
  // behind it. The listener has to sit on the window (like Escape's
  // already does), not on the dialog: a keydown while focus is on
  // <body> never reaches the dialog node, so a handler there could
  // only wrap and could not catch the outside case. Tab and Shift+Tab
  // are preventDefault'ed exactly when we move focus ourselves.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' && e.key !== 'Tab') return
      // Another handler already took this key (for example the Escape
      // or the Tab trap of an overlay opened on top of this dialog), or
      // focus sits in a different modal: leave it alone, so Escape
      // closes only the topmost dialog and Tab does not pull focus back
      // into this dialog behind it.
      if (e.defaultPrevented) return
      const focused = document.activeElement
      const otherModal = focused instanceof Element ? focused.closest('[aria-modal="true"]') : null
      if (otherModal && otherModal !== dialogRef.current) return
      if (e.key === 'Escape') {
        if (step === 'name') onClose()
        return
      }
      const items = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
        : []
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = items.includes(active as HTMLElement)
      if (e.shiftKey) {
        if (active === first || !inside) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !inside) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, onClose])

  if (!open) return null

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    setAttempt((n) => n + 1)
    setError(null)
    const trimmed = name.trim()
    if (trimmed.length === 0) {
      // Required at the UI layer too. The server enforces this
      // (`POST /api/settings/tokens` 400's on empty name) but
      // surfacing it client-side is a nicer UX and avoids a network
      // round-trip.
      setError('Name is required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        let msg = 'Token generation failed'
        try {
          const data = (await res.json()) as { error?: string }
          if (data?.error) msg = data.error
        } catch { /* keep default */ }
        setError(msg)
        return
      }
      const data = (await res.json()) as { token?: string; name?: string }
      if (!data.token) {
        setError('Server did not return a token')
        return
      }
      setToken(data.token)
      setTokenName(data.name ?? trimmed)
      setStep('snippet')
      onTokenCreated?.()
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  async function copy(value: string, kind: 'token' | 'step1' | 'step2') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500)
    } catch {
      // Clipboard write can fail (insecure context, missing user
      // gesture). Fall back silently — operator can still select+copy
      // the rendered text.
    }
  }

  // window.location.origin is reliable on the client (this is a 'use
  // client' component), but if it ever comes back empty (e.g. a test
  // env, an unusual SSR-bypass path) we surface it as an explicit
  // inline error rather than rendering a malformed `--server ''`
  // snippet that would confuse the operator at paste time.
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const originValid = origin.startsWith('http://') || origin.startsWith('https://')
  const steps =
    token !== null && originValid
      ? buildInstallSnippet({ origin, name: tokenName })
      : null

  // Backdrop click only dismisses on the name step. On the snippet
  // step the token is unrecoverable; closing must be deliberate.
  const handleBackdropClick = step === 'name' ? onClose : undefined

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-agent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto bg-white border border-zinc-200 dark:bg-zinc-950 dark:border-zinc-800 rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h2 id="add-agent-title" className="text-base font-semibold text-zinc-800 dark:text-zinc-200">
            Add Agent
          </h2>
          {/* The ✕ button is always available — it's an explicit
              click. Only the *implicit* dismiss paths (backdrop, Esc)
              are gated on the snippet step. */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="min-w-6 min-h-6 inline-flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 text-lg leading-none"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {step === 'name' && (
          <form onSubmit={handleGenerate} noValidate className="px-6 py-5 space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Generate a fresh agent token and get a paste-ready installer command for the host you want to monitor.
            </p>
            <div>
              <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5" htmlFor="add-agent-name">
                Agent name
              </label>
              <input
                ref={nameInputRef}
                id="add-agent-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. lava-vps-01"
                required
                aria-invalid={error === 'Name is required' ? true : undefined}
                aria-describedby={error === 'Name is required' ? 'add-agent-name-error' : undefined}
                className="w-full bg-zinc-50 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-sm px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                Used as the token label in Settings. The agent itself defaults to <code>/etc/hostname</code> for its display name on the dashboard.
              </p>
            </div>
            {!originValid && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                Cannot determine the dashboard origin (current: <code>{origin || '<empty>'}</code>). Reload the page and try again.
              </p>
            )}
            {error && (
              <p role="alert" key={attempt} id="add-agent-name-error" className="text-sm text-red-700 dark:text-red-400">{error}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 px-3 py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !originValid}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-sm text-sm font-medium transition-colors"
              >
                {submitting ? 'Generating…' : 'Generate token'}
              </button>
            </div>
          </form>
        )}

        {step === 'snippet' && token !== null && steps !== null && (
          <div className="px-6 py-5 space-y-5">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Token created for <span className="font-medium text-zinc-800 dark:text-zinc-200">&ldquo;{tokenName}&rdquo;</span>.
              </p>
              <p className="text-xs text-yellow-800 dark:text-yellow-500 mt-1.5">
                ⚠ Shown once: this token won&apos;t be shown again. Copy it now and paste it at the prompt of step 1 below. Click <strong>Done</strong> when finished.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Token</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200 px-3 py-2 rounded-sm font-mono break-all border border-zinc-200 dark:border-zinc-800">
                  {token}
                </code>
                <button
                  ref={tokenCopyButtonRef}
                  onClick={() => void copy(token, 'token')}
                  aria-label="Copy token"
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded-sm transition-colors"
                >
                  {copied === 'token' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Step 1 on the target host: paste and enter the token at the prompt
              </p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 px-3 py-2 rounded-sm font-mono min-w-0 whitespace-pre-wrap break-words border border-zinc-200 dark:border-zinc-800 m-0">
                  {steps.promptStep}
                </pre>
                <button
                  onClick={() => void copy(steps.promptStep, 'step1')}
                  aria-label="Copy step 1"
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded-sm transition-colors"
                >
                  {copied === 'step1' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Step 2 on the target host: run the installer (root required)
              </p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 px-3 py-2 rounded-sm font-mono min-w-0 whitespace-pre-wrap break-words border border-zinc-200 dark:border-zinc-800 m-0">
                  {steps.installStep}
                </pre>
                <button
                  onClick={() => void copy(steps.installStep, 'step2')}
                  aria-label="Copy step 2"
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded-sm transition-colors"
                >
                  {copied === 'step2' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Paste the steps one after the other, never together (a merged paste lets step 1 read step 2 as the token). The installer sets up Node, the agent, and a systemd service; step 2 clears the token from the shell when it finishes. Re-running with a different token rotates cleanly.
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                If <code>sudo</code> answers &ldquo;not allowed to set the following environment variables&rdquo; (restricted sudoers), run the <code>curl … | bash -s -- …</code> line from a root shell without <code>sudo</code>, or use <code>--token-file &lt;path&gt;</code> (see the agent README).
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-sm text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
