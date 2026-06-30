/**
 * Unit tests for src/lib/widgets.ts
 *
 * Simple registry lookup — covers getWidget and the WIDGET_REGISTRY array.
 */

import { describe, it, expect } from 'vitest'
import { WIDGET_REGISTRY, getWidget } from '@/lib/widgets'

describe('getWidget', () => {
  it('returns the widget definition for an existing id', () => {
    const widget = getWidget('log-tail')
    expect(widget).toBeDefined()
    expect(widget?.id).toBe('log-tail')
    expect(widget?.title).toBe('Log Tail')
  })

  it('returns another known widget correctly (metrics)', () => {
    const widget = getWidget('metrics')
    expect(widget).toBeDefined()
    expect(widget?.component).toBe('MetricsWidget')
  })

  it('returns undefined for a nonexistent id', () => {
    expect(getWidget('nonexistent-widget-id')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(getWidget('')).toBeUndefined()
  })
})

describe('WIDGET_REGISTRY', () => {
  it('contains at least one widget entry', () => {
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(0)
  })

  it('all widgets have required string fields: id, title, component', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(typeof w.id).toBe('string')
      expect(w.id.length).toBeGreaterThan(0)
      expect(typeof w.title).toBe('string')
      expect(typeof w.component).toBe('string')
    }
  })

  it('all widgets have valid numeric dimension fields', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(typeof w.defaultW).toBe('number')
      expect(typeof w.defaultH).toBe('number')
      expect(typeof w.minW).toBe('number')
      expect(typeof w.minH).toBe('number')
    }
  })

  it('widget ids are unique within the registry', () => {
    const ids = WIDGET_REGISTRY.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
