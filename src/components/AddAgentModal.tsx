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

/**
 * "Add Agent" modal. Two steps:
 *
 *   1. Operator types a friendly name and hits Generate. We POST
 *      /api/settings/tokens (existing route, unchanged) which returns
 *      the plaintext token *once* + the row's id and name.
 *
 *   2. We render the token in a copy box and a paste-ready
 *      curl-pipe-bash one-liner that bakes in the dashboard's own
 *      origin (proto-swapped to ws/wss) and the new token. The token
 *      is shown once and then unrecoverable.
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
  const [token, setToken] = useState<string | null>(null)
  const [tokenName, setTokenName] = useState<string>('')
  const [copied, setCopied] = useState<'token' | 'snippet' | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const tokenCopyButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousFocusRef = useRef<Element | null>(null)

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
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && step === 'name') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step, onClose])

  if (!open) return null

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
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

  async function copy(value: string, kind: 'token' | 'snippet') {
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
  const snippet =
    token !== null && originValid
      ? buildInstallSnippet({ origin, token, name: tokenName })
      : ''

  // Backdrop click only dismisses on the name step. On the snippet
  // step the token is unrecoverable; closing must be deliberate.
  const handleBackdropClick = step === 'name' ? onClose : undefined

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-agent-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-2xl bg-white border border-zinc-200 dark:bg-zinc-950 dark:border-zinc-800 rounded-xl shadow-2xl"
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
            className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {step === 'name' && (
          <form onSubmit={handleGenerate} className="px-6 py-5 space-y-4">
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
                className="w-full bg-zinc-50 border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-xs text-zinc-400 dark:text-zinc-600 mt-1.5">
                Used as the token label in Settings. The agent itself defaults to <code>/etc/hostname</code> for its display name on the dashboard.
              </p>
            </div>
            {!originValid && (
              <p className="text-sm text-red-500 dark:text-red-400">
                Cannot determine the dashboard origin (current: <code>{origin || '<empty>'}</code>). Reload the page and try again.
              </p>
            )}
            {error && (
              <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
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
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
              >
                {submitting ? 'Generating…' : 'Generate token'}
              </button>
            </div>
          </form>
        )}

        {step === 'snippet' && token !== null && (
          <div className="px-6 py-5 space-y-5">
            <div>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Token created for <span className="font-medium text-zinc-800 dark:text-zinc-200">&ldquo;{tokenName}&rdquo;</span>.
              </p>
              <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1.5">
                ⚠ Copy now — this token won&apos;t be shown again. Click <strong>Done</strong> when finished.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Token</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-800 dark:text-zinc-200 px-3 py-2 rounded font-mono break-all border border-zinc-200 dark:border-zinc-800">
                  {token}
                </code>
                <button
                  ref={tokenCopyButtonRef}
                  onClick={() => void copy(token, 'token')}
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded transition-colors"
                >
                  {copied === 'token' ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Run on the target host (root required)
              </p>
              <div className="flex items-start gap-2">
                <pre className="flex-1 bg-zinc-100 dark:bg-zinc-900 text-xs text-zinc-700 dark:text-zinc-300 px-3 py-2 rounded font-mono whitespace-pre-wrap break-all border border-zinc-200 dark:border-zinc-800 m-0">
                  {snippet}
                </pre>
                <button
                  onClick={() => void copy(snippet, 'snippet')}
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded transition-colors"
                >
                  {copied === 'snippet' ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-zinc-400 dark:text-zinc-600">
                The installer sets up Node, the agent, and a systemd service. Re-running with a different token rotates cleanly.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={onClose}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
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
