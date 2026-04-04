'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error)
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-4 text-center">
          <span className="text-xs font-medium text-red-500">Widget crashed</span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 break-all max-w-full">
            {this.state.error.message}
          </span>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-1 px-2 py-0.5 text-[10px] rounded bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
