/**
 * Shared SWR fetcher with 401 detection.
 * Redirects to /login when the session has expired.
 */
let redirecting = false

export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)

  if (res.status === 401) {
    if (!redirecting && typeof window !== 'undefined') {
      redirecting = true
      window.location.href = '/login'
    }
    throw new Error('Session expired')
  }

  const data = await res.json()
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status })
  }
  return data as T
}
