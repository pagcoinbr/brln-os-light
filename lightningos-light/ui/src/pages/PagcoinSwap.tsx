import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
