import { describe, it, expect } from 'vitest'
import { parseServiceHealthUrls } from '@/lib/service-health'

describe('parseServiceHealthUrls', () => {
  it('returns an empty list when unset or empty', () => {
    expect(parseServiceHealthUrls(undefined)).toEqual([])
    expect(parseServiceHealthUrls('')).toEqual([])
    expect(parseServiceHealthUrls(' , ,')).toEqual([])
  })

  it('names a bare URL after its host', () => {
    expect(parseServiceHealthUrls('https://a.example.com/health')).toEqual([
      { name: 'a.example.com', url: 'https://a.example.com/health' },
    ])
  })

  it('accepts name=url entries, including URLs with a query string containing =', () => {
    expect(parseServiceHealthUrls('api=https://a.example.com/h?x=1, web=http://b.example.com')).toEqual([
      { name: 'api', url: 'https://a.example.com/h?x=1' },
      { name: 'web', url: 'http://b.example.com' },
    ])
  })

  it('skips invalid and non-http(s) entries', () => {
    expect(parseServiceHealthUrls('not a url, ftp://x.example.com, file:///etc/passwd, ok=https://c.example.com')).toEqual([
      { name: 'ok', url: 'https://c.example.com' },
    ])
  })
})
