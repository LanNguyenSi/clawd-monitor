'use client'

import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

interface ActiveAgentContext {
  activeAgentId: string | null
  setActiveAgentId: (id: string | null) => void
}

const Ctx = createContext<ActiveAgentContext>({
  activeAgentId: null,
  setActiveAgentId: () => {},
})

export function ActiveAgentProvider({ children }: { children: ReactNode }) {
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  return <Ctx.Provider value={{ activeAgentId, setActiveAgentId }}>{children}</Ctx.Provider>
}

export function useActiveAgent() {
  return useContext(Ctx)
}
