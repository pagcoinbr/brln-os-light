import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

async function fetchConfig(): Promise<Config> {
  const r = await fetch('/api/apps/pagcoinswap/config')
  if (!r.ok) throw new Error(`config ${r.status}`)
  return r.json()
}

async function saveConfig(patch: Partial<{ operator_key: string; gateway_url: string }>): Promise<Config> {
  const r = await fetch('/api/apps/pagcoinswap/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`config save ${r.status}: ${text}`)
  }
  return r.json()
}

async function proxy<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`/api/apps/pagcoinswap/proxy${path}`, init)
  const ct = r.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    const json = await r.json()
    if (!r.ok) {
      const msg = json?.error || json?.detail || `proxy ${r.status}`
      throw new Error(msg)
    }
    return json as T
  }
  if (!r.ok) throw new Error(`proxy ${r.status}`)
  return (await r.text()) as unknown as T
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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

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

      {!configured && (
        <p className="text-sm text-fog/60">
          {t('pagcoinSwap.notConfigured', { defaultValue: 'Configure o gateway .onion e cole sua chave de operator acima para começar.' })}
        </p>
      )}
    </div>
  )
}
