/**
 * Shared SWR fetcher with 401 detection.
 * Redirects to /login when the session has expired.
 */
export async function fetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url)

  if (res.status === 401) {
    window.location.href = '/login'
    // Never resolves — page is navigating away
    return new Promise(() => {})
  }

  const data = await res.json()
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status })
  }
  return data as T
}
