// react-grid-layout ships its layout helpers as untyped CommonJS under build/.
// Only the functions grid-keyboard.ts uses are declared here.
declare module 'react-grid-layout/build/utils' {
  import type { Layout } from 'react-grid-layout'

  export type CompactType = 'vertical' | 'horizontal' | null | undefined

  export function cloneLayout(layout: Layout[]): Layout[]
  export function getLayoutItem(layout: Layout[], id: string): Layout | undefined
  export function compact(
    layout: Layout[],
    compactType: CompactType,
    cols: number,
    allowOverlap?: boolean,
  ): Layout[]
  export function moveElement(
    layout: Layout[],
    l: Layout,
    x: number | undefined,
    y: number | undefined,
    isUserAction: boolean | undefined,
    preventCollision: boolean | undefined,
    compactType: CompactType,
    cols: number,
    allowOverlap?: boolean,
  ): Layout[]
}

declare module 'react-grid-layout/build/responsiveUtils' {
  import type { Layout } from 'react-grid-layout'
  import type { CompactType } from 'react-grid-layout/build/utils'

  export function getBreakpointFromWidth(breakpoints: Record<string, number>, width: number): string
  export function findOrGenerateResponsiveLayout(
    layouts: Record<string, Layout[]>,
    breakpoints: Record<string, number>,
    breakpoint: string,
    lastBreakpoint: string,
    cols: number,
    compactType: CompactType,
  ): Layout[]
}
