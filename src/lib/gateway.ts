/**
 * Gateway API client — proxies requests to the active OpenClaw instance.
 * Used server-side in API routes.
 */

const DEFAULT_GATEWAY_URL = process.env.NEXT_PUBLIC_DEFAULT_GATEWAY_URL ?? 'http://localhost:9500'
const DEFAULT_GATEWAY_TOKEN = process.env.DEFAULT_GATEWAY_TOKEN ?? ''

export interface GatewayOptions {
  gatewayUrl?: string
  token?: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/**
 * Fetch from the OpenClaw Gateway.
 * Falls back to env-configured default if no instance provided.
 */
export async function gatewayFetch(
  path: string,
  options: GatewayOptions = {}
): Promise<Response> {
  const url = `${options.gatewayUrl ?? DEFAULT_GATEWAY_URL}${path}`
  const token = options.token ?? DEFAULT_GATEWAY_TOKEN

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })
}

/**
 * Convenience: fetch JSON from Gateway.
 */
export async function gatewayJson<T>(
  path: string,
  options: GatewayOptions = {}
): Promise<T> {
  const res = await gatewayFetch(path, options)
  if (!res.ok) {
    throw new Error(`Gateway ${path} returned ${res.status}`)
  }
  return res.json() as Promise<T>
}
