import clsx from '../utils/clsx'

type RouteItem = {
  key: string
  label: string
  element: JSX.Element
}

type SidebarProps = {
  routes: RouteItem[]
  current: string
}

export default function Sidebar({ routes, current }: SidebarProps) {
  return (
    <aside className="lg:h-screen lg:sticky top-0 bg-ink/70 border-b lg:border-b-0 lg:border-r border-white/10 px-6 py-8 lg:w-72">
      <div className="flex items-center justify-between lg:justify-start gap-3">
        <div className="h-10 w-10 rounded-2xl bg-glow/20 border border-glow/30 grid place-items-center text-glow font-semibold">
          Lo
        </div>
        <div>
          <p className="text-lg font-semibold">LightningOS Light</p>
          <p className="text-xs text-fog/60">Mainnet only</p>
        </div>
      </div>
      <div className="mt-8 space-y-2">
        {routes.map((route) => (
          <a
            key={route.key}
            href={`#${route.key}`}
            className={clsx(
              'block px-4 py-3 rounded-2xl text-sm transition',
              current === route.key
                ? 'bg-white/10 text-white shadow-panel'
                : 'text-fog/70 hover:text-white hover:bg-white/5'
            )}
          >
            {route.label}
          </a>
        ))}
      </div>
    </aside>
  )
}
