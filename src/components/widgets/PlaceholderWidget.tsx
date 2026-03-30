export function PlaceholderWidget({ id, title }: { id: string; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-400 dark:text-zinc-700">
      <span className="text-xl">🔧</span>
      <span className="text-xs text-center px-4">{title}</span>
    </div>
  )
}
