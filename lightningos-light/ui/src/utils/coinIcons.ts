// Bundled coin logos sourced from `cryptocurrency-icons` (MIT).
// All ~480 SVGs are static-imported by Vite as URLs.
const modules = import.meta.glob(
  '../../node_modules/cryptocurrency-icons/svg/color/*.svg',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

const byCode: Record<string, string> = {}
let genericUrl: string | null = null

for (const [path, url] of Object.entries(modules)) {
  const m = path.match(/\/([^/]+)\.svg$/)
  if (!m) continue
  const code = m[1].toLowerCase()
  byCode[code] = url
  if (code === 'generic') genericUrl = url
}

// A few tickers our gateway uses that don't have a 1:1 file in the lib.
// Map them to the closest visual equivalent.
const aliases: Record<string, string> = {
  usdt0: 'usdt',     // Tether variant on certain L2s
  weth: 'eth',
  wbtc: 'btc',
  matic: 'matic',
  pol: 'matic',      // Polygon rebrand
  bnb: 'bnb',
  busd: 'busd',
  trx: 'trx',
  usdtbsc: 'usdt',
  usdce: 'usdc',     // bridged USDC
}

export function coinIconUrl(coin: string): string | null {
  const raw = coin.toLowerCase()
  if (byCode[raw]) return byCode[raw]
  if (aliases[raw] && byCode[aliases[raw]]) return byCode[aliases[raw]]
  // Strip trailing digits/suffix (USDT0 -> usdt, USDC1 -> usdc).
  const stripped = raw.replace(/[0-9]+$/, '')
  if (stripped && byCode[stripped]) return byCode[stripped]
  return null
}

export function coinIconOrGeneric(coin: string): string | null {
  return coinIconUrl(coin) ?? genericUrl
}
