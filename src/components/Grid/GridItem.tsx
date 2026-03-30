'use client'

import { forwardRef } from 'react'

interface Props {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
  className?: string
  style?: React.CSSProperties
  editMode?: boolean
  onRemove?: () => void
  onMouseDown?: React.MouseEventHandler
  onMouseUp?: React.MouseEventHandler
  onTouchEnd?: React.TouchEventHandler
}

// forwardRef required by react-grid-layout
export const GridItem = forwardRef<HTMLDivElement, Props>(function GridItem(
  { title, children, loading, error, className, style, editMode, onRemove, onMouseDown, onMouseUp, onTouchEnd },
  ref
) {
  return (
    <div
      ref={ref}
      style={style}
      className={`flex flex-col bg-white border border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800 rounded-xl overflow-hidden ${className ?? ''}`}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchEnd={onTouchEnd}
    >
      {/* Title bar — drag handle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 cursor-grab active:cursor-grabbing shrink-0">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 select-none">{title}</span>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          {editMode && onRemove && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onRemove() }}
              className="ml-1 text-zinc-400 hover:text-red-400 dark:text-zinc-600 dark:hover:text-red-400 transition-colors text-xs leading-none"
              title="Remove widget"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-zinc-400 dark:text-zinc-600 animate-pulse">Loading…</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full px-4">
            <span className="text-xs text-red-500 dark:text-red-400 text-center">{error}</span>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
})
