'use client'

import { useRouter } from 'next/navigation'
import type { ColCount } from '@/types'

interface Props {
  cols: ColCount
  onColsChange: (cols: ColCount) => void
}

export function Navbar({ cols, onColsChange }: Props) {
  const router = useRouter()

  function handleLogout() {
    localStorage.removeItem('clawd-monitor:token')
    document.cookie = 'token=; Max-Age=0; path=/'
    router.push('/login')
  }

  return (
    <nav className="h-12 border-b border-zinc-800 bg-zinc-950 flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm">🐾</span>
        <span className="text-sm font-semibold text-zinc-200">clawd-monitor</span>
      </div>

      <div className="flex-1" />

      {/* Layout selector */}
      <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5">
        {([2, 4, 8] as ColCount[]).map((c) => (
          <button
            key={c}
            onClick={() => onColsChange(c)}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              cols === c
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {c} col
          </button>
        ))}
      </div>

      {/* Instance switcher placeholder */}
      <button className="text-xs text-zinc-500 border border-zinc-800 rounded px-2 py-1 hover:border-zinc-600 transition-colors">
        Local OpenClaw ▾
      </button>

      {/* Logout */}
      <button
        onClick={handleLogout}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Sign out
      </button>
    </nav>
  )
}
