import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'

// Inter is vendored in src/fonts (see src/fonts/README.md) and loaded through
// next/font/local, so a build never fetches fonts from Google Fonts.
//
// next/font/local cannot attach a unicode-range to an individual file, so each
// subset is declared with its own localFont call. Every call sets
// font-family: "Inter" via `declarations`, so next/font keeps that single family
// name across all faces and the browser picks the face by unicode-range — the
// same one-face-per-subset result the Google Fonts loader produced before (it
// also emitted latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext and
// vietnamese for Inter). Only the latin subset is preloaded.
const inter = localFont({
  src: [{ path: '../fonts/inter-latin-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
  ],
})

// The remaining subsets are not preloaded and set adjustFontFallback: false
// (the previous Google Fonts build generated a fallback face only for the
// preloaded latin subset). Their `variable` is never applied in the markup; it
// exists only so the call, and hence its @font-face rule, is kept.
const interLatinExt = localFont({
  src: [{ path: '../fonts/inter-latin-ext-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-latin-ext',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value:
        'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
  ],
})

const interCyrillic = localFont({
  src: [{ path: '../fonts/inter-cyrillic-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-cyrillic',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
    },
  ],
})

const interCyrillicExt = localFont({
  src: [{ path: '../fonts/inter-cyrillic-ext-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-cyrillic-ext',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value: 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F',
    },
  ],
})

const interGreek = localFont({
  src: [{ path: '../fonts/inter-greek-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-greek',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF',
    },
  ],
})

const interGreekExt = localFont({
  src: [{ path: '../fonts/inter-greek-ext-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-greek-ext',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value: 'U+1F00-1FFF',
    },
  ],
})

const interVietnamese = localFont({
  src: [{ path: '../fonts/inter-vietnamese-wght-normal.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  variable: '--font-inter-vietnamese',
  declarations: [
    { prop: 'font-family', value: 'Inter' },
    {
      prop: 'unicode-range',
      value:
        'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
    },
  ],
})

// The subset calls above exist only for their generated CSS (@font-face); their
// className/variable is deliberately not applied anywhere. Referencing the
// consts here keeps the calls (and thus their @font-face rules) in the bundle.
void [interLatinExt, interCyrillic, interCyrillicExt, interGreek, interGreekExt, interVietnamese]

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
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('clawd-monitor:theme');if(t==='light')document.documentElement.classList.remove('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className={`${inter.className} bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 min-h-screen`}>
        {children}
      </body>
    </html>
  )
}
