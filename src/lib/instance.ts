'use client'

import type { Instance } from '@/types'

const STORAGE_KEY = 'clawd-monitor:instances'
const ACTIVE_KEY = 'clawd-monitor:activeInstanceId'

const DEFAULT_INSTANCE: Instance = {
  id: 'default',
  name: 'Local OpenClaw',
  gatewayUrl: process.env.NEXT_PUBLIC_DEFAULT_GATEWAY_URL ?? 'http://localhost:9500',
  token: '',
}

export function getInstances(): Instance[] {
  if (typeof window === 'undefined') return [DEFAULT_INSTANCE]
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [DEFAULT_INSTANCE]
    const parsed = JSON.parse(raw) as Instance[]
    return parsed.length > 0 ? parsed : [DEFAULT_INSTANCE]
  } catch {
    return [DEFAULT_INSTANCE]
  }
}

export function saveInstance(instance: Instance): void {
  const instances = getInstances().filter((i) => i.id !== instance.id)
  instances.push(instance)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(instances))
}

export function removeInstance(id: string): void {
  const instances = getInstances().filter((i) => i.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(instances))
  if (getActiveInstanceId() === id) {
    const next = instances[0]
    if (next) setActiveInstance(next.id)
    else localStorage.removeItem(ACTIVE_KEY)
  }
}

export function getActiveInstanceId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACTIVE_KEY)
}

export function getActiveInstance(): Instance {
  const id = getActiveInstanceId()
  if (!id) return DEFAULT_INSTANCE
  return getInstances().find((i) => i.id === id) ?? DEFAULT_INSTANCE
}

export function setActiveInstance(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}
