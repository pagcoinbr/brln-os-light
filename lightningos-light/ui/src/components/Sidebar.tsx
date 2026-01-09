import { useEffect, useState } from 'react'
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
  const [version, setVersion] = useState('')

  useEffect(() => {
    let active = true
    fetch('/version.txt', { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : ''))
      .then((text) => {
        if (!active) return
        setVersion(text.trim())
      })
      .catch(() => {
        if (!active) return
        setVersion('')
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <aside className="lg:h-screen lg:sticky top-0 bg-ink/70 border-b lg:border-b-0 lg:border-r border-white/10 px-6 py-8 lg:w-72 flex flex-col">
      <div className="flex items-center justify-between lg:justify-start gap-3">
        <div className="h-10 w-10 rounded-2xl bg-glow/20 border border-glow/30 grid place-items-center text-glow font-semibold">
          Lo
        </div>
        <div>
          <p className="text-lg font-semibold">LightningOS Light</p>
          <p className="text-xs text-fog/60">Mainnet only</p>
        </div>
      </div>
      <div className="mt-8 space-y-2 flex-1">
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
      <div className="mt-6 border-t border-white/10 pt-4 text-xs text-fog/60">
        <p>
          Version:{' '}
          <span className="text-fog">{version || 'unavailable'}</span>
        </p>
        <a
          className="mt-2 inline-flex text-fog/70 hover:text-white transition"
          href="https://br-ln.com"
          target="_blank"
          rel="noreferrer"
        >
          Powered By BR⚡LN
        </a>
      </div>
    </aside>
  )
}
