import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { getPagcoinSwapConfig, pagcoinSwapProxy, setPagcoinSwapConfig } from '../api'

// ─── helpers ────────────────────────────────────────────────────────────────

type Config = {
  gateway_url: string
  operator_key_set: boolean
  socks_addr: string
  tor_reachable: boolean
}

// (CreditState removed — operator key from /v1/register is now the gate,
// rate-limited at 2 rps. The /v1/credit endpoints + per-quote allowance
// have been retired on the gateway.)

type Registration = {
  registration_id: string
  status: string
  amount_sats: number
  bolt11: string
  payment_hash: string
  invoice_expires_at: string
  paid_at: string | null
  claimed_at: string | null
  operator_id?: string
  api_key?: string
}

type CatalogEntry = {
  coin: string
  network: string
  name?: string
  has_memo?: boolean
}

type ProviderCatalog = {
  provider_id: string
  entries: CatalogEntry[]
}

type Quote = {
  provider_id: string
  quote_id: string
  rate: string
  to_amount: string
  min_from_amount: string
  max_from_amount: string
  expires_at: string
}

type QuoteResponse = {
  quotes: Quote[]
  best?: Quote
}

type SwapState = {
  swap_id: string
  status: string
  provider_id: string | null
  provider_shift_id: string | null
  from: { coin: string; network: string; amount: string }
  to: { coin: string; network: string; amount: string | null; address: string | null }
  deposit_address: string | null
  deposit_memo?: string
  expires_at: string
  settled_at: string | null
  deposit_seen_at: string | null
  fail_reason: string | null
  claim_token?: string
}

// Stable hue per coin so the placeholder badge gets a recognizable color.
// Hash → 360deg, used as HSL. Looks varied without any asset shipping.
function coinHue(coin: string): number {
  let h = 0
  for (let i = 0; i < coin.length; i++) h = (h * 31 + coin.charCodeAt(i)) >>> 0
  return h % 360
}

function CoinBadge({ coin, size = 36 }: { coin: string; size?: number }) {
  const hue = coinHue(coin)
  const initials = coin.slice(0, 3).toUpperCase()
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-onyx"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 70% 60%)`,
        fontSize: size * 0.35
      }}
    >
      {initials}
    </div>
  )
}

function CoinPickerModal(props: {
  open: boolean
  catalog: CatalogEntry[]
  filter: string
  setFilter: (v: string) => void
  onPick: (c: string, n: string) => void
  onClose: () => void
}) {
  if (!props.open) return null
  const f = props.filter.trim().toLowerCase()
  const filtered = f
    ? props.catalog.filter(
        (e) =>
          e.coin.toLowerCase().includes(f) ||
          e.network.toLowerCase().includes(f) ||
          (e.name ?? '').toLowerCase().includes(f)
      )
    : props.catalog
  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-onyx shadow-xl border border-fog/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-fog/10">
          <input
            autoFocus
            className="w-full rounded-lg bg-onyx/60 px-3 py-2 text-sm"
            placeholder="Search coin or network…"
            value={props.filter}
            onChange={(e) => props.setFilter(e.target.value)}
          />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {filtered.length === 0 && (
            <li className="p-6 text-sm text-fog/50 text-center">No matches</li>
          )}
          {filtered.map((e) => (
            <li
              key={`${e.coin}|${e.network}`}
              className="flex items-center gap-3 p-3 hover:bg-onyx/60 cursor-pointer border-b border-fog/5 last:border-0"
              onClick={() => {
                props.onPick(e.coin, e.network)
                props.onClose()
              }}
            >
              <CoinBadge coin={e.coin} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{e.coin}</div>
                <div className="text-xs text-fog/50">{e.name ?? e.coin}</div>
              </div>
              <div className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full bg-onyx/40 text-fog/70">
                {e.network}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// Thin wrappers around the shared api.ts helpers. These send the
// X-CSRF-Token + credentials cookie automatically, which the raw fetch()
// versions did not — that's why the first deploy returned "invalid csrf
// token" on every POST.
const fetchConfig = (): Promise<Config> => getPagcoinSwapConfig() as Promise<Config>
const saveConfig = (
  patch: Partial<{ operator_key: string; gateway_url: string }>
): Promise<Config> => setPagcoinSwapConfig(patch) as Promise<Config>

async function proxy<T>(path: string, init?: RequestInit): Promise<T> {
  return (await pagcoinSwapProxy(path, init)) as T
}

// ─── page ───────────────────────────────────────────────────────────────────

export default function PagcoinSwap() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<Config | null>(null)
  const [editingKey, setEditingKey] = useState(false)
  const [pendingKey, setPendingKey] = useState('')
  const [pendingURL, setPendingURL] = useState('')
  const [whoami, setWhoami] = useState<{ operator_id: string; display_name: string; valid_until: string | null } | null>(null)
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  // Swap UI state
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [fromCoin, setFromCoin] = useState('USDT')
  const [fromNetwork, setFromNetwork] = useState('tron')
  const [toCoin, setToCoin] = useState('USDT0')
  const [toNetwork, setToNetwork] = useState('polygon')
  const [fromAmount, setFromAmount] = useState('50')
  const [destAddress, setDestAddress] = useState('')
  const [fromPickerOpen, setFromPickerOpen] = useState(false)
  const [toPickerOpen, setToPickerOpen] = useState(false)
  const [pickerFilter, setPickerFilter] = useState('')
  const [latestQuote, setLatestQuote] = useState<Quote | null>(null)
  const [activeSwap, setActiveSwap] = useState<SwapState | null>(null)
  const [depositQr, setDepositQr] = useState<string | null>(null)
  const swapPollRef = useRef<number | null>(null)

  const reloadConfig = useCallback(async () => {
    try {
      const c = await fetchConfig()
      setConfig(c)
      setPendingURL(c.gateway_url)
    } catch (e) {
      setError(String((e as Error).message))
    }
  }, [])

  // Fetch one /v1 endpoint via the local Tor proxy with a single retry on
  // transient failures. The Tor circuit to the gateway onion is often cold
  // on the first request after a page refresh — the first attempt times out
  // or fails routing, the second usually succeeds. Treat 4xx errors as
  // terminal (no retry), only retry on opaque proxy / Tor-side errors.
  const proxyWithRetry = useCallback(async <T,>(path: string): Promise<T> => {
    try {
      return await proxy<T>(path)
    } catch (e) {
      const msg = (e as Error).message ?? ''
      // 4xx-shaped errors are propagated unchanged (no point retrying).
      if (/_/.test(msg) && !/tor|proxy|timeout|fetch|network/i.test(msg)) {
        throw e
      }
      await new Promise((r) => setTimeout(r, 1500))
      return await proxy<T>(path)
    }
  }, [])

  const reloadAll = useCallback(async () => {
    setError(null)
    await reloadConfig()
    try {
      const who = await proxyWithRetry<{ operator_id: string; display_name: string; valid_until: string | null }>('/v1/whoami')
      setWhoami(who)
    } catch (e) {
      setWhoami(null)
      setError(String((e as Error).message))
    }
  }, [reloadConfig, proxyWithRetry])

  useEffect(() => {
    reloadConfig()
  }, [reloadConfig])

  // Once we know the operator key is configured (whether from a fresh save
  // or persisted across a hard refresh), pull whoami + current credit. The
  // bug pre-fix was: initial mount only ran reloadConfig, so even though
  // operator_key_set=true the swap UI stayed gated because `credit` was
  // null until the user clicked Save (which calls reloadAll).
  useEffect(() => {
    if (config?.operator_key_set) {
      void reloadAll()
    }
  }, [config?.operator_key_set, reloadAll])

  const onSaveConfig = async () => {
    setBusy('save-config')
    setError(null)
    try {
      const patch: { operator_key?: string; gateway_url?: string } = {}
      if (pendingKey.trim() !== '') patch.operator_key = pendingKey.trim()
      if (pendingURL.trim() !== '' && pendingURL !== config?.gateway_url) patch.gateway_url = pendingURL.trim()
      const next = await saveConfig(patch)
      setConfig(next)
      setPendingKey('')
      setEditingKey(false)
      // After saving, try to reach the gateway to validate.
      await reloadAll()
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const onCheckConnection = async () => {
    setBusy('check')
    await reloadAll()
    setBusy(null)
  }

  // Load the provider catalog once the operator key works. Cached server-side
  // (5 min), so re-renders that hit this are cheap.
  const loadCatalog = useCallback(async () => {
    try {
      const r = await proxy<{ providers: ProviderCatalog[] }>('/v1/coins')
      const flat = (r.providers ?? []).flatMap((p) => p.entries)
      // Deduplicate by coin+network.
      const seen = new Set<string>()
      const dedup: CatalogEntry[] = []
      for (const e of flat) {
        const k = `${e.coin}|${e.network}`
        if (seen.has(k)) continue
        seen.add(k)
        dedup.push(e)
      }
      dedup.sort((a, b) => a.coin.localeCompare(b.coin) || a.network.localeCompare(b.network))
      setCatalog(dedup)
    } catch (e) {
      // Catalog failure isn't fatal — the user can type pair manually below.
      // eslint-disable-next-line no-console
      console.warn('catalog load failed', e)
    }
  }, [])

  useEffect(() => {
    if (config?.operator_key_set) loadCatalog()
  }, [config?.operator_key_set, loadCatalog])

  const onQuote = async () => {
    setBusy('quote')
    setError(null)
    setLatestQuote(null)
    try {
      const r = await proxy<QuoteResponse>('/v1/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: { coin: fromCoin, network: fromNetwork },
          to: { coin: toCoin, network: toNetwork },
          from_amount: fromAmount
        })
      })
      if (!r.best) {
        setError('no quote returned')
        return
      }
      setLatestQuote(r.best)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const onSwapDirection = () => {
    setFromCoin(toCoin)
    setFromNetwork(toNetwork)
    setToCoin(fromCoin)
    setToNetwork(fromNetwork)
    setLatestQuote(null)
  }

  const onCommitSwap = async () => {
    if (!latestQuote) return
    if (!destAddress.trim()) {
      setError('destination address required')
      return
    }
    setBusy('commit')
    setError(null)
    try {
      const r = await proxy<SwapState>('/v1/swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider_id: latestQuote.provider_id,
          quote_id: latestQuote.quote_id,
          from: { coin: fromCoin, network: fromNetwork },
          to: { coin: toCoin, network: toNetwork },
          from_amount: fromAmount,
          to_amount: latestQuote.to_amount,
          rate: latestQuote.rate,
          quote_expires_at: latestQuote.expires_at,
          to_address: destAddress.trim()
        })
      })
      setActiveSwap(r)
      setLatestQuote(null)
      // Render QR for the deposit address.
      if (r.deposit_address) {
        const dataUrl = await QRCode.toDataURL(r.deposit_address, { margin: 1, width: 240 })
        setDepositQr(dataUrl)
      }
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  // Poll the active swap every 5s until terminal.
  useEffect(() => {
    if (!activeSwap?.swap_id) return
    if (['settled', 'failed', 'expired', 'refunded'].includes(activeSwap.status)) return
    let cancelled = false
    const tick = async () => {
      try {
        const r = await proxy<SwapState>(`/v1/swap/${activeSwap.swap_id}`)
        if (cancelled) return
        setActiveSwap(r)
        if (!['settled', 'failed', 'expired', 'refunded'].includes(r.status)) {
          swapPollRef.current = window.setTimeout(tick, 5000)
        }
      } catch (e) {
        if (cancelled) return
        // Tor blip; back off and retry.
        swapPollRef.current = window.setTimeout(tick, 10_000)
      }
    }
    swapPollRef.current = window.setTimeout(tick, 5000)
    return () => {
      cancelled = true
      if (swapPollRef.current) window.clearTimeout(swapPollRef.current)
    }
  }, [activeSwap?.swap_id, activeSwap?.status])

  // Poll a pending registration until it's claimed or the invoice expires.
  // The first GET that arrives after `paid_at` wins the claim race and
  // receives the api_key in the response — we persist it immediately.
  const pollRegistration = useCallback(async (regId: string) => {
    const start = Date.now()
    // Cap at the invoice TTL plus a small buffer so we eventually stop.
    const maxMs = 60 * 60 * 1000 + 30_000
    while (Date.now() - start < maxMs) {
      try {
        const next = await proxy<Registration>(`/v1/register/${regId}`)
        setRegistration(next)
        if (next.status === 'claimed' && next.api_key) {
          // Persist the key into the local secrets env so the proxy injects
          // it on every subsequent /v1/* call.
          const saved = await saveConfig({ operator_key: next.api_key })
          setConfig(saved)
          // Stop showing the invoice; reload whoami + credit so the UI
          // shifts into the "ready to swap" state.
          setRegistration(null)
          await reloadAll()
          return
        }
        if (next.status === 'expired') return
      } catch (e) {
        // Tor blip / transient; keep polling.
        // eslint-disable-next-line no-console
        console.warn('register poll error', e)
      }
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }, [reloadAll])

  const onRegister = async () => {
    setBusy('register')
    setError(null)
    try {
      const reg = await proxy<Registration>('/v1/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName.trim() || undefined })
      })
      setRegistration(reg)
      // Kick off polling in the background; UI shows the bolt11 in the meantime.
      void pollRegistration(reg.registration_id)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const configured = config?.operator_key_set && config?.gateway_url

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Pagcoin Swap</h1>
        <p className="text-sm text-fog/60">
          {t('pagcoinSwap.tagline', { defaultValue: 'Troque criptos via Tor. As chamadas saem do seu nó para o onion do Pagcoin; o navegador nunca toca a rede onion.' })}
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* ─── Settings card ─── */}
      <section className="section-card space-y-4">
        <h2 className="text-lg font-semibold">{t('pagcoinSwap.settings', { defaultValue: 'Conexão' })}</h2>
        <div className="grid gap-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-fog/60 w-40">Tor SOCKS:</span>
            <span className="font-mono">{config?.socks_addr || '—'}</span>
            {config && (
              <span className={`text-xs uppercase px-2 py-0.5 rounded-full ${config.tor_reachable ? 'bg-emerald-500/20 text-emerald-200' : 'bg-red-500/20 text-red-200'}`}>
                {config.tor_reachable ? 'reachable' : 'unreachable'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fog/60 w-40">Gateway .onion:</span>
            <input
              className="flex-1 rounded bg-onyx/40 px-2 py-1 font-mono text-xs"
              value={pendingURL}
              onChange={(e) => setPendingURL(e.target.value)}
              placeholder="http://...onion"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-fog/60 w-40">Operator API key:</span>
            {editingKey ? (
              <input
                className="flex-1 rounded bg-onyx/40 px-2 py-1 font-mono text-xs"
                type="password"
                value={pendingKey}
                onChange={(e) => setPendingKey(e.target.value)}
                placeholder="sgo_..."
                autoFocus
              />
            ) : (
              <span className="flex-1 text-xs text-fog/60">
                {config?.operator_key_set ? '✓ configured (paste new value to replace)' : 'not set'}
              </span>
            )}
            <button
              type="button"
              className="text-xs uppercase tracking-wide px-3 py-1 rounded-full bg-brass/20 text-brass border border-brass/40 hover:bg-brass/30"
              onClick={() => setEditingKey(!editingKey)}
            >
              {editingKey ? 'cancel' : 'edit'}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy === 'save-config'}
            className="text-xs uppercase tracking-wide px-4 py-2 rounded-full bg-brass text-onyx font-semibold disabled:opacity-50"
            onClick={onSaveConfig}
          >
            {busy === 'save-config' ? 'saving…' : 'save'}
          </button>
          <button
            type="button"
            disabled={busy === 'check'}
            className="text-xs uppercase tracking-wide px-4 py-2 rounded-full border border-fog/30 text-fog disabled:opacity-50"
            onClick={onCheckConnection}
          >
            {busy === 'check' ? 'checking…' : 'check connection'}
          </button>
        </div>
        {whoami && (
          <div className="text-xs text-fog/60 space-y-0.5">
            <p>connected as <span className="font-mono">{whoami.display_name}</span> (id <span className="font-mono">{whoami.operator_id.slice(0, 8)}…</span>)</p>
            {whoami.valid_until ? (
              <p>
                subscription valid until <span className="font-mono">{new Date(whoami.valid_until).toLocaleDateString()}</span>
                {(() => {
                  const days = Math.floor((new Date(whoami.valid_until!).getTime() - Date.now()) / 86_400_000)
                  if (days < 0) return <span className="text-red-300 ml-1">(expired)</span>
                  if (days < 14) return <span className="text-amber-300 ml-1">({days} days left)</span>
                  return <span className="text-fog/40 ml-1">({days} days left)</span>
                })()}
              </p>
            ) : (
              <p className="text-fog/40">no expiry (internal operator)</p>
            )}
          </div>
        )}
      </section>

      {/* ─── New swap (SideShift-style) ─── */}
      {configured && whoami && !activeSwap && (
        <section className="section-card space-y-4">
          <h2 className="text-lg font-semibold">{t('pagcoinSwap.newSwap', { defaultValue: 'Novo swap' })}</h2>

          {/* SEND panel */}
          <div className="rounded-2xl bg-onyx/40 p-4 border border-fog/5">
            <div className="text-xs uppercase tracking-wide text-fog/50 mb-2">You send</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full bg-onyx/60 hover:bg-onyx/80 transition px-2 py-1 pr-3 border border-fog/10"
                onClick={() => { setPickerFilter(''); setFromPickerOpen(true) }}
              >
                <CoinBadge coin={fromCoin} />
                <div className="text-left">
                  <div className="text-sm font-semibold leading-none">{fromCoin}</div>
                  <div className="text-[10px] uppercase tracking-wide text-fog/50">{fromNetwork}</div>
                </div>
                <span className="text-fog/40 ml-1">▾</span>
              </button>
              <input
                className="flex-1 bg-transparent text-right text-2xl font-mono outline-none placeholder-fog/30"
                value={fromAmount}
                onChange={(e) => { setFromAmount(e.target.value); setLatestQuote(null) }}
                inputMode="decimal"
                placeholder="0"
              />
            </div>
          </div>

          {/* Direction swap button */}
          <div className="flex justify-center -my-2">
            <button
              type="button"
              aria-label="swap direction"
              className="rounded-full bg-onyx border border-fog/20 w-10 h-10 flex items-center justify-center text-fog hover:text-brass hover:border-brass/40 transition"
              onClick={onSwapDirection}
            >
              <span style={{ display: 'inline-block', transform: 'rotate(90deg)' }}>⇄</span>
            </button>
          </div>

          {/* GET panel */}
          <div className="rounded-2xl bg-onyx/40 p-4 border border-fog/5">
            <div className="text-xs uppercase tracking-wide text-fog/50 mb-2">You get</div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="flex items-center gap-2 rounded-full bg-onyx/60 hover:bg-onyx/80 transition px-2 py-1 pr-3 border border-fog/10"
                onClick={() => { setPickerFilter(''); setToPickerOpen(true) }}
              >
                <CoinBadge coin={toCoin} />
                <div className="text-left">
                  <div className="text-sm font-semibold leading-none">{toCoin}</div>
                  <div className="text-[10px] uppercase tracking-wide text-fog/50">{toNetwork}</div>
                </div>
                <span className="text-fog/40 ml-1">▾</span>
              </button>
              <div className="flex-1 text-right text-2xl font-mono text-fog/60">
                {latestQuote ? latestQuote.to_amount : '—'}
              </div>
            </div>
          </div>

          {/* Rate row */}
          <div className="text-xs text-fog/60 flex items-center justify-between px-2">
            <span>
              {latestQuote
                ? <>Rate: <span className="font-mono text-fog/80">1 {fromCoin} ≈ {latestQuote.rate} {toCoin}</span></>
                : <span className="text-fog/40">Quote to see the rate</span>}
            </span>
            {latestQuote && (
              <span className="text-fog/40 text-[10px]">via {latestQuote.provider_id} · expires {new Date(latestQuote.expires_at).toLocaleTimeString()}</span>
            )}
          </div>

          {/* Destination */}
          <div>
            <label className="text-xs text-fog/60 block mb-1">Receive at ({toCoin}-{toNetwork})</label>
            <input
              className="w-full rounded-xl bg-onyx/40 px-3 py-2 text-sm font-mono"
              value={destAddress}
              onChange={(e) => setDestAddress(e.target.value)}
              placeholder={toNetwork === 'tron' ? 'T...' : toNetwork === 'bitcoin' ? 'bc1...' : toNetwork === 'liquid' ? 'lq1...' : '0x...'}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy === 'quote' || !fromAmount}
              className="flex-1 text-xs uppercase tracking-wide px-4 py-2.5 rounded-full border border-fog/30 text-fog disabled:opacity-50 hover:border-brass/40 transition"
              onClick={onQuote}
            >
              {busy === 'quote' ? 'quoting…' : latestQuote ? 're-quote' : 'get quote'}
            </button>
            <button
              type="button"
              disabled={busy === 'commit' || !latestQuote || !destAddress.trim()}
              className="flex-[2] text-xs uppercase tracking-wide px-4 py-2.5 rounded-full bg-brass text-onyx font-semibold disabled:opacity-50 hover:opacity-90 transition"
              onClick={onCommitSwap}
            >
              {busy === 'commit' ? 'committing…' : 'commit swap'}
            </button>
          </div>

          {/* Pickers */}
          <CoinPickerModal
            open={fromPickerOpen}
            catalog={catalog}
            filter={pickerFilter}
            setFilter={setPickerFilter}
            onPick={(c, n) => { setFromCoin(c); setFromNetwork(n); setLatestQuote(null) }}
            onClose={() => setFromPickerOpen(false)}
          />
          <CoinPickerModal
            open={toPickerOpen}
            catalog={catalog}
            filter={pickerFilter}
            setFilter={setPickerFilter}
            onPick={(c, n) => { setToCoin(c); setToNetwork(n); setLatestQuote(null) }}
            onClose={() => setToPickerOpen(false)}
          />
        </section>
      )}

      {/* ─── Active swap ─── */}
      {activeSwap && (
        <section className="section-card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('pagcoinSwap.activeSwap', { defaultValue: 'Swap em andamento' })}</h2>
            <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full bg-onyx/40 text-fog/80">{activeSwap.status}</span>
          </div>
          <div className="text-sm space-y-1">
            <div className="flex justify-between"><span className="text-fog/60">Send:</span><span className="font-mono">{activeSwap.from.amount} {activeSwap.from.coin} ({activeSwap.from.network})</span></div>
            <div className="flex justify-between"><span className="text-fog/60">Receive:</span><span className="font-mono">{activeSwap.to.amount ?? '…'} {activeSwap.to.coin} ({activeSwap.to.network})</span></div>
            {activeSwap.to.address && (
              <div className="flex justify-between gap-2"><span className="text-fog/60">To address:</span><span className="font-mono text-xs break-all text-right">{activeSwap.to.address}</span></div>
            )}
          </div>
          {activeSwap.deposit_address && (
            <div className="space-y-2">
              <p className="text-xs text-fog/60">Send the deposit to:</p>
              {depositQr && <img src={depositQr} alt="deposit address QR" className="bg-white rounded p-2 mx-auto" />}
              <input
                readOnly
                className="w-full rounded bg-onyx/40 px-2 py-1 font-mono text-xs"
                value={activeSwap.deposit_address}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              />
              {activeSwap.deposit_memo && (
                <p className="text-xs text-amber-200">Memo required: <span className="font-mono">{activeSwap.deposit_memo}</span></p>
              )}
              <p className="text-xs text-fog/50">Expires at {new Date(activeSwap.expires_at).toLocaleString()}</p>
            </div>
          )}
          {activeSwap.fail_reason && (
            <p className="text-xs text-red-200">{activeSwap.fail_reason}</p>
          )}
          {['settled', 'failed', 'expired', 'refunded'].includes(activeSwap.status) && (
            <button
              type="button"
              className="text-xs uppercase tracking-wide px-4 py-2 rounded-full border border-fog/30 text-fog"
              onClick={() => { setActiveSwap(null); setDepositQr(null) }}
            >
              new swap
            </button>
          )}
        </section>
      )}

      {/* ─── Self-service registration ─── */}
      {!config?.operator_key_set && (
        <section className="section-card space-y-4">
          <h2 className="text-lg font-semibold">{t('pagcoinSwap.register', { defaultValue: 'Registrar operador' })}</h2>
          <p className="text-sm text-fog/60">
            {t('pagcoinSwap.registerHint', {
              defaultValue: 'Pague 1.000 sats via Lightning para criar uma chave de operator válida por 6 meses. A chave é salva automaticamente neste nó assim que o pagamento confirma.'
            })}
          </p>
          {!registration && (
            <div className="space-y-3">
              <input
                className="w-full rounded bg-onyx/40 px-2 py-1 text-sm"
                placeholder="display name (opcional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <button
                type="button"
                disabled={busy === 'register' || !config?.tor_reachable}
                className="text-xs uppercase tracking-wide px-4 py-2 rounded-full bg-brass text-onyx font-semibold disabled:opacity-50"
                onClick={onRegister}
              >
                {busy === 'register' ? 'requesting…' : `register (1,000 sats)`}
              </button>
              {!config?.tor_reachable && (
                <p className="text-xs text-amber-300">Tor não está acessível em {config?.socks_addr}. Verifique antes de registrar.</p>
              )}
            </div>
          )}
          {registration && (
            <div className="space-y-3">
              <div>
                <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full bg-onyx/40 text-fog/80">{registration.status}</span>
                <span className="ml-3 text-fog/60 text-sm">
                  {registration.amount_sats} sats
                </span>
              </div>
              {registration.status === 'awaiting_payment' && (
                <>
                  <textarea
                    readOnly
                    className="w-full rounded bg-onyx/40 px-2 py-1 font-mono text-[10px] break-all"
                    rows={4}
                    value={registration.bolt11}
                    onClick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
                  />
                  <p className="text-xs text-fog/50">
                    Aguardando pagamento… expira em {new Date(registration.invoice_expires_at).toLocaleString()}
                  </p>
                </>
              )}
              {registration.status === 'paid' && (
                <p className="text-xs text-emerald-200">Pago — emitindo a chave de operator…</p>
              )}
              {registration.status === 'expired' && (
                <p className="text-xs text-red-200">Invoice expirou sem pagamento. Tente novamente.</p>
              )}
            </div>
          )}
        </section>
      )}

      {!configured && config?.operator_key_set === false && (
        <p className="text-sm text-fog/60">
          {t('pagcoinSwap.notConfigured', { defaultValue: 'Configure o gateway .onion e registre um operator acima para começar.' })}
        </p>
      )}
    </div>
  )
}
