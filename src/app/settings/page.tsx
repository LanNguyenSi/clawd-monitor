'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ThemeProvider, useTheme } from '@/lib/theme'
import { buildInstallSnippet } from '@/lib/install-snippet'

interface TokenEntry {
  id: string
  name: string
  createdAt: string
  lastUsedAt?: string
}

function revokeConfirmMessage(name: string): string {
  return `Revoke token "${name}"? Any agent using it loses access immediately. This cannot be undone.`
}

function SettingsInner() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [ready, setReady] = useState(false)

  // Password change
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwStatus, setPwStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [pwMsg, setPwMsg] = useState('')

  // Token management
  const [tokens, setTokens] = useState<TokenEntry[]>([])
  const [tokenName, setTokenName] = useState('')
  const [newToken, setNewToken] = useState<{ token: string; name: string } | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  // Shown above the generate form (generate) and under the token list (revoke, rename).
  const [generateError, setGenerateError] = useState('')
  const [listError, setListError] = useState('')
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const revokeInFlight = useRef(false)
  // Inline name editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const loadTokens = useCallback(async () => {
    const res = await fetch('/api/settings/tokens')
    if (res.ok) setTokens((await res.json()).tokens ?? [])
  }, [])

  useEffect(() => {
    let mounted = true

    async function checkAuth() {
      try {
        const res = await fetch('/api/auth')
        if (!res.ok) {
          router.replace('/login')
          return
        }

        const data = await res.json() as { authenticated?: boolean }
        if (!data.authenticated) {
          router.replace('/login')
          return
        }

        if (!mounted) {
          return
        }

        setReady(true)
        await loadTokens()
      } catch {
        router.replace('/login')
      }
    }

    void checkAuth()
    return () => {
      mounted = false
    }
  }, [router, loadTokens])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwStatus('loading')
    setPwMsg('')
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw, confirmPassword: pwForm.confirm }),
      })
      const data = await res.json()
      if (!res.ok) { setPwStatus('error'); setPwMsg(data.error ?? 'Failed') }
      else {
        setPwStatus('success')
        setPwMsg('Password updated — logging you out…')
        setPwForm({ current: '', newPw: '', confirm: '' })
        setTimeout(() => {
          void fetch('/api/auth', { method: 'DELETE' }).finally(() => {
            window.location.assign('/login')
          })
        }, 2000)
      }
    } catch { setPwStatus('error'); setPwMsg('Network error') }
  }

  async function handleGenerateToken(e: React.FormEvent) {
    e.preventDefault()
    const name = tokenName.trim()
    if (!name) return
    setGenerateError('')
    setTokenLoading(true)
    try {
      let res: Response
      try {
        res = await fetch('/api/settings/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
      } catch {
        setGenerateError(`Could not generate token "${name}": network error. Your input is kept; reload to check whether the token was created before trying again.`)
        return
      }
      if (!res.ok) {
        setGenerateError(`Could not generate token "${name}" (HTTP ${res.status}). No token is shown and your input is kept; try again.`)
        return
      }
      const data = await res.json()
      setNewToken({ token: data.token, name: data.name })
      setTokenName('')
      await loadTokens()
    } finally { setTokenLoading(false) }
  }

  async function handleRevokeToken(t: TokenEntry) {
    if (revokeInFlight.current) return
    setListError('')
    if (!window.confirm(revokeConfirmMessage(t.name))) return
    revokeInFlight.current = true
    setRevokingId(t.id)
    try {
      const res = await fetch(`/api/settings/tokens/${t.id}`, { method: 'DELETE' })
      if (!res.ok) {
        setListError(`Could not revoke token "${t.name}" (HTTP ${res.status}). The token list was not changed; reload to see its current state.`)
        return
      }
    } catch {
      setListError(`Could not revoke token "${t.name}": network error. The token list was not changed; reload to see its current state.`)
      return
    } finally {
      revokeInFlight.current = false
      setRevokingId(null)
    }
    await loadTokens()
  }

  function startEdit(t: TokenEntry) {
    setListError('')
    setEditingId(t.id)
    setEditName(t.name)
  }

  async function saveEdit(t: TokenEntry) {
    setListError('')
    if (!editName.trim()) { setEditingId(null); return }
    try {
      const res = await fetch(`/api/settings/tokens/${t.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      })
      if (!res.ok) {
        setListError(`Could not rename token "${t.name}" (HTTP ${res.status}). The name was not changed; your edit is still open.`)
        return
      }
    } catch {
      setListError(`Could not rename token "${t.name}": network error. The name may not have changed; your edit is still open.`)
      return
    }
    setEditingId(null)
    await loadTokens()
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  if (!ready) return null

  const installSnippet = newToken
    ? buildInstallSnippet({
        origin: window.location.origin,
        token: newToken.token,
        name: newToken.name,
      })
    : ''

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <nav className="h-12 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 flex items-center px-6 gap-4">
        <Link href="/dashboard" className="text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"><span aria-hidden="true">🐾</span> clawd-monitor</Link>
        <span className="text-zinc-300 dark:text-zinc-700">/</span>
        <span className="text-sm text-zinc-700 dark:text-zinc-300">Settings</span>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        <h1 className="sr-only">Settings</h1>

        {/* Appearance */}
        <section>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">Appearance</h2>
          <div className="bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-800 dark:text-zinc-200">Theme</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">Keyboard shortcut: <kbd className="font-mono bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-sm px-1">t</kbd></p>
              </div>
              <div role="group" aria-label="Theme" className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded-lg p-0.5">
                <button
                  onClick={() => setTheme('light')}
                  aria-pressed={theme === 'light'}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    theme === 'light'
                      ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-300'
                  }`}
                >
                  <span aria-hidden="true">☀️</span> Light
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  aria-pressed={theme === 'dark'}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    theme === 'dark'
                      ? 'bg-white text-zinc-900 shadow-xs dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-300'
                  }`}
                >
                  <span aria-hidden="true">🌙</span> Dark
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Change Password */}
        <section>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">Change Password</h2>
          <form onSubmit={handleChangePassword} className="space-y-4 bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl p-6">
            {(['current', 'newPw', 'confirm'] as const).map((field) => (
              <div key={field}>
                <label htmlFor={`pw-${field}`} className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                  {field === 'current' ? 'Current password' : field === 'newPw' ? 'New password (min 8 chars)' : 'Confirm new password'}
                </label>
                <input type="password" id={`pw-${field}`}
                  autoComplete={field === 'current' ? 'current-password' : 'new-password'}
                  value={pwForm[field]}
                  onChange={(e) => setPwForm({ ...pwForm, [field]: e.target.value })}
                  required minLength={field !== 'current' ? 8 : undefined}
                  className="w-full bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded-sm px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}
            {/* A failure interrupts (alert); a success is confirmation (status, polite). Each attempt clears
                the message first, so the outcome always mounts a fresh element with its role already set;
                screen readers do not reliably announce a role that changes on a node already in the page. */}
            {pwMsg && (
              <p
                role={pwStatus === 'success' ? 'status' : 'alert'}
                className={`text-sm ${pwStatus === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}
              >{pwMsg}</p>
            )}
            <button type="submit" disabled={pwStatus === 'loading'}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-sm text-sm font-medium transition-colors">
              {pwStatus === 'loading' ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </section>

        {/* Agent Tokens */}
        <section>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">Agent Tokens</h2>
          <div className="bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl overflow-hidden">

            {/* Existing tokens */}
            {tokens.length > 0 && (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {tokens.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      {editingId === t.id ? (
                        <form onSubmit={(e) => { e.preventDefault(); void saveEdit(t) }} className="flex items-center gap-2">
                          <input
                            type="text"
                            aria-label={`Name for token ${t.name}`}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            className="bg-zinc-50 border border-indigo-500 dark:bg-zinc-800 rounded-sm px-2 py-0.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-hidden w-40"
                          />
                          <button type="submit" className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-200 px-1.5">Save</button>
                          <button type="button" onClick={() => setEditingId(null)} className="text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 px-1.5">Cancel</button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="text-sm text-zinc-800 dark:text-zinc-200">{t.name}</div>
                          <button
                            onClick={() => startEdit(t)}
                            className="min-w-6 min-h-6 inline-flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                            title="Edit name"
                            aria-label={`Edit name of token ${t.name}`}
                          ><span aria-hidden="true">✏️</span></button>
                        </div>
                      )}
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        Created {new Date(t.createdAt).toLocaleDateString()}
                        {t.lastUsedAt && ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    {editingId !== t.id && (
                      <button onClick={() => void handleRevokeToken(t)}
                        aria-label={`Revoke token ${t.name}`}
                        aria-disabled={revokingId !== null}
                        className="text-xs text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors px-2 py-1 rounded-sm border border-red-300 dark:border-red-900 hover:border-red-400 dark:hover:border-red-700">
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {listError && (
              <div role="alert" className="px-5 py-3 text-sm text-red-700 dark:text-red-400 border-t border-zinc-200 dark:border-zinc-800">
                {listError}
              </div>
            )}

            {/* Generate new token */}
            <div className="p-5 border-t border-zinc-200 dark:border-zinc-800">
              <form onSubmit={handleGenerateToken}>
                <label htmlFor="token-name" className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Agent name</label>
                {/* Stacked below sm: side by side, the input and the nowrap button do not fit a 390 px card. */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input type="text" id="token-name" value={tokenName} onChange={(e) => setTokenName(e.target.value)}
                    placeholder="e.g. Lava VPS" required
                    className="min-w-0 flex-1 bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded-sm px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-500 dark:placeholder-zinc-400 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                  <button type="submit" disabled={tokenLoading}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-sm text-sm transition-colors whitespace-nowrap">
                    {tokenLoading ? '…' : '+ Generate Token'}
                  </button>
                </div>
                {generateError && (
                  <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">{generateError}</p>
                )}
              </form>
            </div>
          </div>

          {/* Show new token (once) */}
          {newToken && (
            <div className="mt-4 bg-indigo-50 border border-indigo-200 dark:bg-zinc-900 dark:border-indigo-700/50 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Token generated for &ldquo;{newToken.name}&rdquo;</h3>
                <button onClick={() => setNewToken(null)} aria-label="Dismiss generated token" className="min-w-6 min-h-6 inline-flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm"><span aria-hidden="true">✕</span></button>
              </div>
              <p className="text-xs text-yellow-800 dark:text-yellow-500">⚠ Copy this token now — it won&apos;t be shown again.</p>

              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 px-3 py-2 rounded-sm font-mono break-all">
                  {newToken.token}
                </code>
                <button onClick={() => copyToClipboard(newToken.token)}
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded-sm transition-colors">
                  Copy
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Install command (run on the target host as root):</p>
                <div className="flex items-start gap-2">
                  <code className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 px-3 py-2 rounded-sm font-mono whitespace-pre-wrap break-all">{installSnippet}</code>
                  <button onClick={() => copyToClipboard(installSnippet)}
                    className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded-sm transition-colors">
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default function SettingsPage() {
  return (
    <ThemeProvider>
      <SettingsInner />
    </ThemeProvider>
  )
}
