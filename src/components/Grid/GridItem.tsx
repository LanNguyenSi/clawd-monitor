'use client'

import { forwardRef } from 'react'

interface Props {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
  className?: string
  style?: React.CSSProperties
  onMouseDown?: React.MouseEventHandler
  onMouseUp?: React.MouseEventHandler
  onTouchEnd?: React.TouchEventHandler
}

// forwardRef required by react-grid-layout
export const GridItem = forwardRef<HTMLDivElement, Props>(function GridItem(
  { title, children, loading, error, className, style, onMouseDown, onMouseUp, onTouchEnd },
  ref
) {
  return (
    <div
      ref={ref}
      style={style}
      className={`flex flex-col bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden ${className ?? ''}`}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      {/* Title bar — drag handle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 cursor-grab active:cursor-grabbing shrink-0">
        <span className="text-xs font-medium text-zinc-400 select-none">{title}</span>
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-zinc-600 animate-pulse">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="text-xs text-red-400 text-center">{error}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
})
