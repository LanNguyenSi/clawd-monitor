'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ThemeProvider, useTheme } from '@/lib/theme'

interface TokenEntry {
  id: string
  name: string
  createdAt: string
  lastUsedAt?: string
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
    if (!tokenName.trim()) return
    setTokenLoading(true)
    try {
      const res = await fetch('/api/settings/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        setNewToken({ token: data.token, name: data.name })
        setTokenName('')
        await loadTokens()
      }
    } finally { setTokenLoading(false) }
  }

  async function handleRevokeToken(id: string) {
    await fetch(`/api/settings/tokens/${id}`, { method: 'DELETE' })
    await loadTokens()
  }

  function startEdit(t: TokenEntry) {
    setEditingId(t.id)
    setEditName(t.name)
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) { setEditingId(null); return }
    await fetch(`/api/settings/tokens/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    setEditingId(null)
    await loadTokens()
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {})
  }

  if (!ready) return null

  const serverUrl = window.location.origin

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <nav className="h-12 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 flex items-center px-6 gap-4">
        <Link href="/dashboard" className="text-sm font-semibold text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">🐾 clawd-monitor</Link>
        <span className="text-zinc-300 dark:text-zinc-700">/</span>
        <span className="text-sm text-zinc-700 dark:text-zinc-300">Settings</span>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">

        {/* Appearance */}
        <section>
          <h2 className="text-base font-semibold text-zinc-800 dark:text-zinc-200 mb-4">Appearance</h2>
          <div className="bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-800 dark:text-zinc-200">Theme</p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">Keyboard shortcut: <kbd className="font-mono bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded px-1">t</kbd></p>
              </div>
              <div className="flex items-center gap-0.5 bg-zinc-100 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded-lg p-0.5">
                <button
                  onClick={() => setTheme('light')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    theme === 'light'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  ☀️ Light
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                    theme === 'dark'
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                  }`}
                >
                  🌙 Dark
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
                <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">
                  {field === 'current' ? 'Current password' : field === 'newPw' ? 'New password (min 8 chars)' : 'Confirm new password'}
                </label>
                <input type="password" value={pwForm[field]}
                  onChange={(e) => setPwForm({ ...pwForm, [field]: e.target.value })}
                  required minLength={field !== 'current' ? 8 : undefined}
                  className="w-full bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}
            {pwMsg && <p className={`text-sm ${pwStatus === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{pwMsg}</p>}
            <button type="submit" disabled={pwStatus === 'loading'}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors">
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
                        <form onSubmit={(e) => { e.preventDefault(); void saveEdit(t.id) }} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            className="bg-zinc-50 border border-indigo-500 dark:bg-zinc-800 rounded px-2 py-0.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none w-40"
                          />
                          <button type="submit" className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-200 px-1.5">Save</button>
                          <button type="button" onClick={() => setEditingId(null)} className="text-xs text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 px-1.5">Cancel</button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <div className="text-sm text-zinc-800 dark:text-zinc-200">{t.name}</div>
                          <button
                            onClick={() => startEdit(t)}
                            className="text-xs text-zinc-400 dark:text-zinc-700 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
                            title="Edit name"
                          >✏️</button>
                        </div>
                      )}
                      <div className="text-xs text-zinc-400 dark:text-zinc-600">
                        Created {new Date(t.createdAt).toLocaleDateString()}
                        {t.lastUsedAt && ` · Last used ${new Date(t.lastUsedAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    {editingId !== t.id && (
                      <button onClick={() => void handleRevokeToken(t.id)}
                        className="text-xs text-zinc-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 transition-colors px-2 py-1 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-800">
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Generate new token */}
            <div className="p-5 border-t border-zinc-200 dark:border-zinc-800">
              <form onSubmit={handleGenerateToken} className="flex gap-2">
                <input type="text" value={tokenName} onChange={(e) => setTokenName(e.target.value)}
                  placeholder="Agent name (e.g. Lava VPS)" required
                  className="flex-1 bg-zinc-50 border border-zinc-200 dark:bg-zinc-800 dark:border-zinc-700 rounded px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button type="submit" disabled={tokenLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm transition-colors whitespace-nowrap">
                  {tokenLoading ? '…' : '+ Generate Token'}
                </button>
              </form>
            </div>
          </div>

          {/* Show new token (once) */}
          {newToken && (
            <div className="mt-4 bg-indigo-50 border border-indigo-200 dark:bg-zinc-900 dark:border-indigo-700/50 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Token generated for &ldquo;{newToken.name}&rdquo;</h3>
                <button onClick={() => setNewToken(null)} className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 text-sm">✕</button>
              </div>
              <p className="text-xs text-yellow-600 dark:text-yellow-500">⚠ Copy this token now — it won&apos;t be shown again.</p>

              <div className="flex items-center gap-2">
                <code className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-800 dark:text-zinc-200 px-3 py-2 rounded font-mono break-all">
                  {newToken.token}
                </code>
                <button onClick={() => copyToClipboard(newToken.token)}
                  className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded transition-colors">
                  Copy
                </button>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-zinc-500">Install command:</p>
                <div className="flex items-start gap-2">
                  <code className="flex-1 bg-zinc-100 dark:bg-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 px-3 py-2 rounded font-mono whitespace-pre-wrap">{`npm install -g clawd-monitor-agent
clawd-monitor-agent \\
  --server ${serverUrl} \\
  --token ${newToken.token} \\
  --name "${newToken.name}"`}</code>
                  <button onClick={() => copyToClipboard(`npm install -g clawd-monitor-agent\nclawd-monitor-agent \\\n  --server ${serverUrl} \\\n  --token ${newToken.token} \\\n  --name "${newToken.name}"`)}
                    className="shrink-0 text-xs bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-zinc-700 dark:text-zinc-200 px-3 py-2 rounded transition-colors">
                    Copy
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
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
