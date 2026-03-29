'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function SettingsPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  // Password change form
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwStatus, setPwStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [pwMsg, setPwMsg] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('clawd-monitor:token')
    if (!token) { router.replace('/login'); return }
    setReady(true)
  }, [router])

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwStatus('loading')
    setPwMsg('')

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: pwForm.current,
          newPassword: pwForm.newPw,
          confirmPassword: pwForm.confirm,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPwStatus('error')
        setPwMsg(data.error ?? 'Failed to change password')
      } else {
        setPwStatus('success')
        setPwMsg('Password updated. You will be logged out.')
        setPwForm({ current: '', newPw: '', confirm: '' })
        setTimeout(() => {
          localStorage.removeItem('clawd-monitor:token')
          router.push('/login')
        }, 2000)
      }
    } catch {
      setPwStatus('error')
      setPwMsg('Network error')
    }
  }

  if (!ready) return null

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Nav */}
      <nav className="h-12 border-b border-zinc-800 flex items-center px-6 gap-4">
        <Link href="/dashboard" className="text-sm font-semibold text-zinc-400 hover:text-zinc-200">
          🐾 clawd-monitor
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm text-zinc-300">Settings</span>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-10 space-y-10">
        {/* Change Password */}
        <section>
          <h2 className="text-base font-semibold text-zinc-200 mb-4">Change Password</h2>
          <form onSubmit={handleChangePassword} className="space-y-4 bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            {(['current', 'newPw', 'confirm'] as const).map((field) => (
              <div key={field}>
                <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                  {field === 'current' ? 'Current password' : field === 'newPw' ? 'New password' : 'Confirm new password'}
                </label>
                <input
                  type="password"
                  value={pwForm[field]}
                  onChange={(e) => setPwForm({ ...pwForm, [field]: e.target.value })}
                  required
                  minLength={field !== 'current' ? 8 : undefined}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            ))}

            {pwMsg && (
              <p className={`text-sm ${pwStatus === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                {pwMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={pwStatus === 'loading'}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm font-medium transition-colors"
            >
              {pwStatus === 'loading' ? 'Updating…' : 'Update Password'}
            </button>
          </form>
        </section>

        {/* Agent Tokens placeholder — W7-002 */}
        <section>
          <h2 className="text-base font-semibold text-zinc-200 mb-2">Agent Tokens</h2>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 text-center">
            <p className="text-xs text-zinc-600">Token management coming in W7-002</p>
          </div>
        </section>
      </div>
    </div>
  )
}
