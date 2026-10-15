/**
 * SERVICE_HEALTH_URLS: comma-separated entries, each `https://host/path` or
 * `name=https://host/path`. Unset or empty means no services are checked.
 */
export function parseServiceHealthUrls(raw: string | undefined): { name: string; url: string }[] {
  const services: { name: string; url: string }[] = []
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim()
    if (!entry) continue
    const eq = entry.indexOf('=')
    const hasName = eq > 0 && !entry.slice(0, eq).includes('/') && !entry.slice(0, eq).includes(':')
    const url = (hasName ? entry.slice(eq + 1) : entry).trim()
    let host: string
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      host = parsed.host
    } catch {
      continue
    }
    services.push({ name: hasName ? entry.slice(0, eq).trim() : host, url })
  }
  return services
}
