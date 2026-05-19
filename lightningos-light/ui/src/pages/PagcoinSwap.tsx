import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import QRCode from 'qrcode'
import { getPagcoinSwapConfig, pagcoinSwapProxy, setPagcoinSwapConfig } from '../api'
import pagcoinLogo from '../assets/pagcoin-logo.png'
import { coinIconUrl } from '../utils/coinIcons'
import '../styles/pagcoin-swap.css'

// ─── helpers ────────────────────────────────────────────────────────────────

type Config = {
  gateway_url: string
  operator_key_set: boolean
  socks_addr: string
  tor_reachable: boolean
}

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

function coinHue(coin: string): number {
  let h = 0
  for (let i = 0; i < coin.length; i++) h = (h * 31 + coin.charCodeAt(i)) >>> 0
  return h % 360
}

function CoinBadge({ coin, size = 36 }: { coin: string; size?: number }) {
  const iconUrl = coinIconUrl(coin)
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={coin}
        className="pswap-coin-badge pswap-coin-badge-img"
        style={{ width: size, height: size }}
      />
    )
  }
  const hue = coinHue(coin)
  const initials = coin.slice(0, 3).toUpperCase()
  return (
    <div
      className="pswap-coin-badge"
      style={{
        width: size,
        height: size,
        background: `hsl(${hue} 70% 65%)`,
        fontSize: size * 0.35
      }}
    >
      {initials}
    </div>
  )
}

function pillForStatus(status: string): string {
  if (status === 'settled' || status === 'claimed' || status === 'paid') return 'pswap-pill pswap-pill-ok'
  if (status === 'failed' || status === 'expired') return 'pswap-pill pswap-pill-bad'
  if (status === 'awaiting_payment') return 'pswap-pill pswap-pill-warn'
  return 'pswap-pill pswap-pill-info'
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
    <div className="pswap-modal-backdrop" onClick={props.onClose}>
      <div className="pswap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pswap-modal-header">
          <input
            autoFocus
            className="pswap-input"
            placeholder="Search coin or network…"
            value={props.filter}
            onChange={(e) => props.setFilter(e.target.value)}
          />
        </div>
        <ul className="pswap-modal-list">
          {filtered.length === 0 && (
            <li className="pswap-modal-empty">No matches</li>
          )}
          {filtered.map((e) => (
            <li
              key={`${e.coin}|${e.network}`}
              className="pswap-modal-item"
              onClick={() => {
                props.onPick(e.coin, e.network)
                props.onClose()
              }}
            >
              <CoinBadge coin={e.coin} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pswap-coin-name">{e.coin}</div>
                <div className="pswap-coin-network">{e.name ?? e.coin}</div>
              </div>
              <span className="pswap-pill pswap-pill-info">{e.network}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// Thin wrappers around the shared api.ts helpers. These send the
// X-CSRF-Token + credentials cookie automatically.
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

  // Tor circuit cold-start retry — see prior history for context.
  const proxyWithRetry = useCallback(async <T,>(path: string): Promise<T> => {
    try {
      return await proxy<T>(path)
    } catch (e) {
      const msg = (e as Error).message ?? ''
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

  const loadCatalog = useCallback(async () => {
    try {
      const r = await proxy<{ providers: ProviderCatalog[] }>('/v1/coins')
      const flat = (r.providers ?? []).flatMap((p) => p.entries)
      const seen = new Set<string>()
      const dedup: CatalogEntry[] = []
      for (const e of flat) {
        const k = `${e.coin}|${e.network}`
        if (seen.has(k)) continue
        // Drop coins we don't have a bundled logo for — keeps the picker visually clean.
        if (!coinIconUrl(e.coin)) continue
        seen.add(k)
        dedup.push(e)
      }
      dedup.sort((a, b) => a.coin.localeCompare(b.coin) || a.network.localeCompare(b.network))
      setCatalog(dedup)
    } catch (e) {
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
        swapPollRef.current = window.setTimeout(tick, 10_000)
      }
    }
    swapPollRef.current = window.setTimeout(tick, 5000)
    return () => {
      cancelled = true
      if (swapPollRef.current) window.clearTimeout(swapPollRef.current)
    }
  }, [activeSwap?.swap_id, activeSwap?.status])

  const pollRegistration = useCallback(async (regId: string) => {
    const start = Date.now()
    const maxMs = 60 * 60 * 1000 + 30_000
    while (Date.now() - start < maxMs) {
      try {
        const next = await proxy<Registration>(`/v1/register/${regId}`)
        setRegistration(next)
        if (next.status === 'claimed' && next.api_key) {
          const saved = await saveConfig({ operator_key: next.api_key })
          setConfig(saved)
          setRegistration(null)
          await reloadAll()
          return
        }
        if (next.status === 'expired') return
      } catch (e) {
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
      void pollRegistration(reg.registration_id)
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  const configured = config?.operator_key_set && config?.gateway_url

  return (
    <div className="pswap-root pswap-stack">
      <header className="pswap-header">
        <img src={pagcoinLogo} alt="Pagcoin" className="pswap-logo" />
        <div>
          <h1>Pagcoin Swap</h1>
          <p className="pswap-tagline">
            {t('pagcoinSwap.tagline', { defaultValue: 'Troque criptos via Tor. As chamadas saem do seu nó para o onion do Pagcoin; o navegador nunca toca a rede onion.' })}
          </p>
        </div>
      </header>

      {error && <div className="pswap-alert">{error}</div>}

      {/* ─── Settings card ─── */}
      <section className="pswap-card pswap-stack">
        <h2>{t('pagcoinSwap.settings', { defaultValue: 'Conexão' })}</h2>
        <div className="pswap-stack-sm">
          <div className="pswap-row">
            <label>Tor SOCKS:</label>
            <span className="pswap-mono">{config?.socks_addr || '—'}</span>
            {config && (
              <span className={config.tor_reachable ? 'pswap-pill pswap-pill-ok' : 'pswap-pill pswap-pill-bad'}>
                {config.tor_reachable ? 'reachable' : 'unreachable'}
              </span>
            )}
          </div>
          <div className="pswap-row">
            <label>Gateway .onion:</label>
            <input
              className="pswap-input pswap-mono"
              style={{ flex: 1 }}
              value={pendingURL}
              onChange={(e) => setPendingURL(e.target.value)}
              placeholder="http://...onion"
            />
          </div>
          <div className="pswap-row">
            <label>Operator API key:</label>
            {editingKey ? (
              <input
                className="pswap-input pswap-mono"
                style={{ flex: 1 }}
                type="password"
                value={pendingKey}
                onChange={(e) => setPendingKey(e.target.value)}
                placeholder="sgo_..."
                autoFocus
              />
            ) : (
              <span className="pswap-muted" style={{ flex: 1, fontSize: 13 }}>
                {config?.operator_key_set ? '✓ configured (paste new value to replace)' : 'not set'}
              </span>
            )}
            <button type="button" className="pswap-btn" onClick={() => setEditingKey(!editingKey)}>
              {editingKey ? 'cancel' : 'edit'}
            </button>
          </div>
        </div>
        <div className="pswap-row">
          <button
            type="button"
            disabled={busy === 'save-config'}
            className="pswap-btn pswap-btn-primary"
            onClick={onSaveConfig}
          >
            {busy === 'save-config' ? 'saving…' : 'save'}
          </button>
          <button
            type="button"
            disabled={busy === 'check'}
            className="pswap-btn"
            onClick={onCheckConnection}
          >
            {busy === 'check' ? 'checking…' : 'check connection'}
          </button>
        </div>
        {whoami && (
          <div style={{ fontSize: 13 }} className="pswap-stack-sm">
            <p>connected as <span className="pswap-mono"><strong>{whoami.display_name}</strong></span> (id <span className="pswap-mono">{whoami.operator_id.slice(0, 8)}…</span>)</p>
            {whoami.valid_until ? (
              <p className="pswap-muted">
                subscription valid until <span className="pswap-mono">{new Date(whoami.valid_until).toLocaleDateString()}</span>
                {(() => {
                  const days = Math.floor((new Date(whoami.valid_until!).getTime() - Date.now()) / 86_400_000)
                  if (days < 0) return <span style={{ color: 'var(--pswap-danger)', marginLeft: 6 }}>(expired)</span>
                  if (days < 14) return <span style={{ color: 'var(--pswap-warn)', marginLeft: 6 }}>({days} days left)</span>
                  return <span style={{ marginLeft: 6 }}>({days} days left)</span>
                })()}
              </p>
            ) : (
              <p className="pswap-muted">no expiry (internal operator)</p>
            )}
          </div>
        )}
      </section>

      {/* ─── New swap (SideShift-style) ─── */}
      {configured && whoami && !activeSwap && (
        <section className="pswap-card pswap-stack">
          <h2>{t('pagcoinSwap.newSwap', { defaultValue: 'Novo swap' })}</h2>

          {/* SEND panel */}
          <div className="pswap-card-inset">
            <div className="pswap-coin-network" style={{ marginBottom: 10 }}>You send</div>
            <div className="pswap-row" style={{ flexWrap: 'nowrap' }}>
              <button
                type="button"
                className="pswap-coin-trigger"
                onClick={() => { setPickerFilter(''); setFromPickerOpen(true) }}
              >
                <CoinBadge coin={fromCoin} />
                <div style={{ textAlign: 'left' }}>
                  <div className="pswap-coin-name">{fromCoin}</div>
                  <div className="pswap-coin-network">{fromNetwork}</div>
                </div>
                <span style={{ color: 'var(--pswap-muted)', marginLeft: 4 }}>▾</span>
              </button>
              <input
                className="pswap-amount"
                value={fromAmount}
                onChange={(e) => { setFromAmount(e.target.value); setLatestQuote(null) }}
                inputMode="decimal"
                placeholder="0"
              />
            </div>
          </div>

          {/* Direction swap button */}
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: -8, marginBottom: -8 }}>
            <button
              type="button"
              aria-label="swap direction"
              className="pswap-direction"
              onClick={onSwapDirection}
            >
              ⇅
            </button>
          </div>

          {/* GET panel */}
          <div className="pswap-card-inset">
            <div className="pswap-coin-network" style={{ marginBottom: 10 }}>You get</div>
            <div className="pswap-row" style={{ flexWrap: 'nowrap' }}>
              <button
                type="button"
                className="pswap-coin-trigger"
                onClick={() => { setPickerFilter(''); setToPickerOpen(true) }}
              >
                <CoinBadge coin={toCoin} />
                <div style={{ textAlign: 'left' }}>
                  <div className="pswap-coin-name">{toCoin}</div>
                  <div className="pswap-coin-network">{toNetwork}</div>
                </div>
                <span style={{ color: 'var(--pswap-muted)', marginLeft: 4 }}>▾</span>
              </button>
              <div className="pswap-amount" style={{ color: 'var(--pswap-muted)' }}>
                {latestQuote ? latestQuote.to_amount : '—'}
              </div>
            </div>
          </div>

          {/* Rate row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '0 4px' }}>
            <span>
              {latestQuote
                ? <>Rate: <span className="pswap-mono"><strong>1 {fromCoin} ≈ {latestQuote.rate} {toCoin}</strong></span></>
                : <span className="pswap-muted">Quote to see the rate</span>}
            </span>
            {latestQuote && (
              <span className="pswap-muted" style={{ fontSize: 11 }}>via {latestQuote.provider_id} · expires {new Date(latestQuote.expires_at).toLocaleTimeString()}</span>
            )}
          </div>

          {/* Destination */}
          <div>
            <label className="pswap-coin-network" style={{ display: 'block', marginBottom: 6 }}>Receive at ({toCoin}-{toNetwork})</label>
            <input
              className="pswap-input pswap-mono"
              value={destAddress}
              onChange={(e) => setDestAddress(e.target.value)}
              placeholder={toNetwork === 'tron' ? 'T...' : toNetwork === 'bitcoin' ? 'bc1...' : toNetwork === 'liquid' ? 'lq1...' : '0x...'}
            />
          </div>

          {/* Action buttons */}
          <div className="pswap-row">
            <button
              type="button"
              disabled={busy === 'quote' || !fromAmount}
              className="pswap-btn"
              style={{ flex: 1 }}
              onClick={onQuote}
            >
              {busy === 'quote' ? 'quoting…' : latestQuote ? 're-quote' : 'get quote'}
            </button>
            <button
              type="button"
              disabled={busy === 'commit' || !latestQuote || !destAddress.trim()}
              className="pswap-btn pswap-btn-primary"
              style={{ flex: 2 }}
              onClick={onCommitSwap}
            >
              {busy === 'commit' ? 'committing…' : 'commit swap'}
            </button>
          </div>

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
        <section className="pswap-card pswap-stack-sm">
          <div className="pswap-row" style={{ justifyContent: 'space-between' }}>
            <h2>{t('pagcoinSwap.activeSwap', { defaultValue: 'Swap em andamento' })}</h2>
            <span className={pillForStatus(activeSwap.status)}>{activeSwap.status}</span>
          </div>
          <div className="pswap-stack-sm">
            <div className="pswap-kv"><span className="pswap-kv-label">Send:</span><span className="pswap-kv-value">{activeSwap.from.amount} {activeSwap.from.coin} ({activeSwap.from.network})</span></div>
            <div className="pswap-kv"><span className="pswap-kv-label">Receive:</span><span className="pswap-kv-value">{activeSwap.to.amount ?? '…'} {activeSwap.to.coin} ({activeSwap.to.network})</span></div>
            {activeSwap.to.address && (
              <div className="pswap-kv"><span className="pswap-kv-label">To address:</span><span className="pswap-kv-value">{activeSwap.to.address}</span></div>
            )}
          </div>
          {activeSwap.deposit_address && (
            <div className="pswap-stack-sm">
              <p className="pswap-muted" style={{ fontSize: 13 }}>Send the deposit to:</p>
              {depositQr && <img src={depositQr} alt="deposit address QR" className="pswap-qr" />}
              <input
                readOnly
                className="pswap-input pswap-mono"
                value={activeSwap.deposit_address}
                onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              />
              {activeSwap.deposit_memo && (
                <p style={{ fontSize: 13, color: 'var(--pswap-warn)' }}>Memo required: <span className="pswap-mono"><strong>{activeSwap.deposit_memo}</strong></span></p>
              )}
              <p className="pswap-muted" style={{ fontSize: 12 }}>Expires at {new Date(activeSwap.expires_at).toLocaleString()}</p>
            </div>
          )}
          {activeSwap.fail_reason && (
            <p style={{ fontSize: 13, color: 'var(--pswap-danger)' }}>{activeSwap.fail_reason}</p>
          )}
          {['settled', 'failed', 'expired', 'refunded'].includes(activeSwap.status) && (
            <button
              type="button"
              className="pswap-btn"
              onClick={() => { setActiveSwap(null); setDepositQr(null) }}
            >
              new swap
            </button>
          )}
        </section>
      )}

      {/* ─── Self-service registration ─── */}
      {!config?.operator_key_set && (
        <section className="pswap-card pswap-stack">
          <h2>{t('pagcoinSwap.register', { defaultValue: 'Registrar operador' })}</h2>
          <p className="pswap-muted" style={{ fontSize: 14 }}>
            {t('pagcoinSwap.registerHint', {
              defaultValue: 'Pague 1.000 sats via Lightning para criar uma chave de operator válida por 6 meses. A chave é salva automaticamente neste nó assim que o pagamento confirma.'
            })}
          </p>
          {!registration && (
            <div className="pswap-stack-sm">
              <input
                className="pswap-input"
                placeholder="display name (opcional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <button
                type="button"
                disabled={busy === 'register' || !config?.tor_reachable}
                className="pswap-btn pswap-btn-primary"
                onClick={onRegister}
              >
                {busy === 'register' ? 'requesting…' : `register (1,000 sats)`}
              </button>
              {!config?.tor_reachable && (
                <p style={{ fontSize: 13, color: 'var(--pswap-warn)' }}>Tor não está acessível em {config?.socks_addr}. Verifique antes de registrar.</p>
              )}
            </div>
          )}
          {registration && (
            <div className="pswap-stack-sm">
              <div className="pswap-row">
                <span className={pillForStatus(registration.status)}>{registration.status}</span>
                <span className="pswap-muted" style={{ fontSize: 14 }}>{registration.amount_sats} sats</span>
              </div>
              {registration.status === 'awaiting_payment' && (
                <>
                  <textarea
                    readOnly
                    className="pswap-input pswap-mono"
                    style={{ fontSize: 11, wordBreak: 'break-all', resize: 'vertical' }}
                    rows={4}
                    value={registration.bolt11}
                    onClick={(e) => (e.currentTarget as HTMLTextAreaElement).select()}
                  />
                  <p className="pswap-muted" style={{ fontSize: 12 }}>
                    Aguardando pagamento… expira em {new Date(registration.invoice_expires_at).toLocaleString()}
                  </p>
                </>
              )}
              {registration.status === 'paid' && (
                <p style={{ fontSize: 13, color: 'var(--pswap-ok)' }}>Pago — emitindo a chave de operator…</p>
              )}
              {registration.status === 'expired' && (
                <p style={{ fontSize: 13, color: 'var(--pswap-danger)' }}>Invoice expirou sem pagamento. Tente novamente.</p>
              )}
            </div>
          )}
        </section>
      )}

      {!configured && config?.operator_key_set === false && (
        <p className="pswap-muted" style={{ fontSize: 14 }}>
          {t('pagcoinSwap.notConfigured', { defaultValue: 'Configure o gateway .onion e registre um operator acima para começar.' })}
        </p>
      )}
    </div>
  )
}
