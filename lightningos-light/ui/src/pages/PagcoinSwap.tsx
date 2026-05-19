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

type CreditState = {
  credit_id: string
  status: string
  amount_sats: number
  bolt11: string
  payment_hash: string
  invoice_expires_at: string
  paid_at: string | null
  valid_until: string | null
  quote_allowance: number
  quotes_used: number
  quotes_remaining: number
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
  credit?: {
    quotes_used: number
    quote_allowance: number
    quotes_remaining: number
  }
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
  const [whoami, setWhoami] = useState<{ operator_id: string; display_name: string } | null>(null)
  const [credit, setCredit] = useState<CreditState | null>(null)
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

  const reloadAll = useCallback(async () => {
    setError(null)
    await reloadConfig()
    try {
      const who = await proxy<{ operator_id: string; display_name: string }>('/v1/whoami')
      setWhoami(who)
    } catch (e) {
      setWhoami(null)
      setError(String((e as Error).message))
      return
    }
    try {
      const c = await proxy<CreditState>('/v1/credit/current')
      setCredit(c)
    } catch (e) {
      // 404 no_credit is normal pre-payment.
      const msg = (e as Error).message
      if (!msg.toLowerCase().includes('no_credit')) setError(msg)
      setCredit(null)
    }
  }, [reloadConfig])

  useEffect(() => {
    reloadConfig()
  }, [reloadConfig])

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

  const onMintCredit = async () => {
    setBusy('mint')
    setError(null)
    try {
      const c = await proxy<CreditState>('/v1/credit', { method: 'POST' })
      setCredit(c)
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
      // /v1/quote echoes back the post-decrement credit state — keep our UI in sync.
      if (r.credit) {
        setCredit((c) => (c ? { ...c, quotes_used: r.credit!.quotes_used, quotes_remaining: r.credit!.quotes_remaining } : c))
      }
    } catch (e) {
      setError(String((e as Error).message))
    } finally {
      setBusy(null)
    }
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
          <p className="text-xs text-fog/60">
            connected as <span className="font-mono">{whoami.display_name}</span> (id <span className="font-mono">{whoami.operator_id.slice(0, 8)}…</span>)
          </p>
        )}
      </section>

      {/* ─── Credit card ─── */}
      {configured && (
        <section className="section-card space-y-4">
          <h2 className="text-lg font-semibold">{t('pagcoinSwap.credit', { defaultValue: 'Crédito de cotações' })}</h2>
          {credit ? (
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-xs uppercase tracking-wide px-2 py-0.5 rounded-full bg-onyx/40 text-fog/80">{credit.status}</span>
                {credit.status === 'active' && (
                  <span className="ml-3 text-fog/60">
                    {credit.quotes_remaining} / {credit.quote_allowance} cotações restantes
                  </span>
                )}
              </div>
              {credit.status === 'awaiting_payment' && (
                <div className="space-y-2">
                  <p className="text-xs text-fog/60">Pague para ativar (válido por 24h, 50 cotações):</p>
                  <textarea
                    readOnly
                    className="w-full rounded bg-onyx/40 px-2 py-1 font-mono text-[10px] break-all"
                    rows={4}
                    value={credit.bolt11}
                  />
                  <p className="text-xs text-fog/50">
                    Expira em {new Date(credit.invoice_expires_at).toLocaleString()}
                  </p>
                </div>
              )}
              {credit.valid_until && (
                <p className="text-xs text-fog/50">válido até {new Date(credit.valid_until).toLocaleString()}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-fog/60">Nenhum crédito ativo. Mintar para liberar cotações:</p>
          )}
          <button
            type="button"
            disabled={busy === 'mint'}
            className="text-xs uppercase tracking-wide px-4 py-2 rounded-full bg-brass text-onyx font-semibold disabled:opacity-50"
            onClick={onMintCredit}
          >
            {busy === 'mint' ? 'requesting…' : credit?.status === 'awaiting_payment' ? 'reload current invoice' : 'mint new invoice (100 sats)'}
          </button>
        </section>
      )}

      {/* ─── New swap ─── */}
      {configured && credit?.status === 'active' && !activeSwap && (
        <section className="section-card space-y-4">
          <h2 className="text-lg font-semibold">{t('pagcoinSwap.newSwap', { defaultValue: 'Novo swap' })}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-fog/60 space-y-1">
              <span>From</span>
              <select
                className="w-full rounded bg-onyx/40 px-2 py-1 text-sm"
                value={`${fromCoin}|${fromNetwork}`}
                onChange={(e) => {
                  const [c, n] = e.target.value.split('|')
                  setFromCoin(c)
                  setFromNetwork(n)
                  setLatestQuote(null)
                }}
              >
                {catalog.length === 0 && <option value={`${fromCoin}|${fromNetwork}`}>{fromCoin} ({fromNetwork})</option>}
                {catalog.map((e) => (
                  <option key={`${e.coin}|${e.network}`} value={`${e.coin}|${e.network}`}>{e.coin} ({e.network})</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-fog/60 space-y-1">
              <span>To</span>
              <select
                className="w-full rounded bg-onyx/40 px-2 py-1 text-sm"
                value={`${toCoin}|${toNetwork}`}
                onChange={(e) => {
                  const [c, n] = e.target.value.split('|')
                  setToCoin(c)
                  setToNetwork(n)
                  setLatestQuote(null)
                }}
              >
                {catalog.length === 0 && <option value={`${toCoin}|${toNetwork}`}>{toCoin} ({toNetwork})</option>}
                {catalog.map((e) => (
                  <option key={`${e.coin}|${e.network}`} value={`${e.coin}|${e.network}`}>{e.coin} ({e.network})</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-fog/60 space-y-1">
              <span>Amount ({fromCoin})</span>
              <input
                className="w-full rounded bg-onyx/40 px-2 py-1 text-sm font-mono"
                value={fromAmount}
                onChange={(e) => { setFromAmount(e.target.value); setLatestQuote(null) }}
                inputMode="decimal"
                placeholder="50"
              />
            </label>
            <label className="text-xs text-fog/60 space-y-1">
              <span>Receive at ({toNetwork})</span>
              <input
                className="w-full rounded bg-onyx/40 px-2 py-1 text-sm font-mono"
                value={destAddress}
                onChange={(e) => setDestAddress(e.target.value)}
                placeholder={toNetwork === 'tron' ? 'T...' : toNetwork === 'bitcoin' ? 'bc1...' : '0x...'}
              />
            </label>
          </div>

          {latestQuote ? (
            <div className="rounded-lg bg-onyx/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-fog/60">Rate:</span><span className="font-mono">{latestQuote.rate}</span></div>
              <div className="flex justify-between"><span className="text-fog/60">You receive:</span><span className="font-mono">{latestQuote.to_amount} {toCoin}</span></div>
              <div className="flex justify-between"><span className="text-fog/60">Quote expires:</span><span className="text-xs">{new Date(latestQuote.expires_at).toLocaleString()}</span></div>
              <div className="text-xs text-fog/50">via {latestQuote.provider_id}</div>
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy === 'quote' || !fromAmount}
              className="text-xs uppercase tracking-wide px-4 py-2 rounded-full border border-fog/30 text-fog disabled:opacity-50"
              onClick={onQuote}
            >
              {busy === 'quote' ? 'quoting…' : latestQuote ? 're-quote' : 'get quote'}
            </button>
            <button
              type="button"
              disabled={busy === 'commit' || !latestQuote || !destAddress.trim()}
              className="text-xs uppercase tracking-wide px-4 py-2 rounded-full bg-brass text-onyx font-semibold disabled:opacity-50"
              onClick={onCommitSwap}
            >
              {busy === 'commit' ? 'committing…' : 'commit swap'}
            </button>
          </div>
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
              defaultValue: 'Pague 1.000 sats via Lightning para criar uma chave de operator. A chave é salva automaticamente neste nó assim que o pagamento confirma.'
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
