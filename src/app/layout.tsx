import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'clawd-monitor',
  description: 'OpenClaw instance monitoring dashboard',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 min-h-screen`}>
        {children}
      </body>
    </html>
  )
}
