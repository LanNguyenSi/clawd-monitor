import type { ReactNode, Ref } from 'react'

interface Props {
  /** Accessible name of the region, e.g. "Cron jobs". */
  label: string
  className?: string
  children: ReactNode
  scrollRef?: Ref<HTMLDivElement>
}

/**
 * Scrollable content area of a widget. A scroll container that holds no
 * focusable child cannot be scrolled with the keyboard, so it is made
 * focusable itself and named as a region; the focus ring is drawn inside the
 * box because the widget frame clips overflow.
 */
export function ScrollRegion({ label, className = '', children, scrollRef }: Props) {
  return (
    <div
      ref={scrollRef}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={`overflow-y-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 ${className}`}
    >
      {children}
    </div>
  )
}
