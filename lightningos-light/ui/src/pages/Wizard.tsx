import { useEffect, useState } from 'react'
import {
  createWalletSeed,
  initWallet,
  postBitcoinRemote,
  unlockWallet,
  getBitcoin
} from '../api'

export default function Wizard() {
  const [step, setStep] = useState(1)
  const [rpcUser, setRpcUser] = useState('')
  const [rpcPass, setRpcPass] = useState('')
  const [bitcoinHost, setBitcoinHost] = useState('')
  const [zmqBlock, setZmqBlock] = useState('')
  const [zmqTx, setZmqTx] = useState('')
  const [walletMode, setWalletMode] = useState<'create' | 'import'>('create')
  const [walletPassword, setWalletPassword] = useState('')
  const [walletPasswordConfirm, setWalletPasswordConfirm] = useState('')
  const [seedWords, setSeedWords] = useState<string[]>([])
  const [seedInput, setSeedInput] = useState('')
  const [ackSeed, setAckSeed] = useState(false)
  const [unlockPass, setUnlockPass] = useState('')
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState<'neutral' | 'success' | 'warn' | 'error'>('neutral')

  useEffect(() => {
    getBitcoin().then((data: any) => {
      setBitcoinHost(data.rpchost)
      setZmqBlock(data.zmq_rawblock)
      setZmqTx(data.zmq_rawtx)
    }).catch(() => null)
  }, [])

  const next = () => setStep((prev) => Math.min(prev + 1, 4))

  const syncLabel = (info: any) => {
    const progress = info?.verification_progress ?? info?.verificationprogress
    if (typeof progress !== 'number') {
      return 'n/a'
    }
    return `${(progress * 100).toFixed(2)}%`
  }

  const formatBitcoinInfo = (info: any, rpcOk?: boolean) => {
    const ok = rpcOk ?? info?.rpc_ok ?? false
    if (!ok) {
      return 'RPC validation failed. Check credentials.'
    }
    if (!info) {
      return 'RPC OK.'
    }
    if (typeof info.blocks === 'number' && info.chain) {
      return `RPC OK. ${info.chain} @ ${info.blocks} (${syncLabel(info)})`
    }
    return 'RPC OK.'
  }

  const handleBitcoin = async () => {
    setStatus('Testing connection...')
    setStatusTone('warn')
    try {
      const res: any = await postBitcoinRemote({ rpcuser: rpcUser, rpcpass: rpcPass })
      setStatus(formatBitcoinInfo(res?.info, true))
      setStatusTone('success')
      setRpcPass('')
      getBitcoin()
        .then((updated: any) => {
          setBitcoinHost(updated.rpchost)
          setZmqBlock(updated.zmq_rawblock)
          setZmqTx(updated.zmq_rawtx)
        })
        .catch(() => null)
      next()
    } catch (err: any) {
      setStatus(err?.message || 'Failed to validate RPC. Check credentials.')
      setStatusTone('error')
    }
  }

  const handleGenerateSeed = async () => {
    setStatus('Generating seed...')
    setStatusTone('warn')
    try {
      const res = await createWalletSeed()
      setSeedWords(res.seed_words || [])
      setStatus('Seed generated. Write it down.')
      setStatusTone('success')
    } catch (err: any) {
      setStatus(err?.message || 'Seed generation failed.')
      setStatusTone('error')
    }
  }

  const handleInitWallet = async () => {
    if (!walletPassword || walletPassword !== walletPasswordConfirm) {
      setStatus('Wallet password mismatch.')
      setStatusTone('error')
      return
    }

    const words = walletMode === 'create' ? seedWords : seedInput.trim().split(/\s+/)
    if (words.length < 12) {
      setStatus('Seed words invalid.')
      setStatusTone('error')
      return
    }
    if (walletMode === 'create' && !ackSeed) {
      setStatus('Confirm that you wrote down the seed.')
      setStatusTone('error')
      return
    }

    setStatus('Initializing wallet...')
    setStatusTone('warn')
    try {
      await initWallet({ wallet_password: walletPassword, seed_words: words })
      setStatus('Wallet initialized. Auto-unlock configured.')
      setStatusTone('success')
      setStep(4)
    } catch (err: any) {
      const message = err?.message || 'Wallet init failed.'
      if (message.toLowerCase().includes('wallet already exists')) {
        setStatus('Wallet already exists. Unlock it in the next step.')
        setStatusTone('warn')
        setStep(3)
        return
      }
      setStatus(message)
      setStatusTone('error')
    }
  }

  const handleUnlock = async () => {
    if (!unlockPass) {
      setStatus('Enter wallet password.')
      setStatusTone('error')
      return
    }
    setStatus('Unlocking...')
    setStatusTone('warn')
    try {
      await unlockWallet({ wallet_password: unlockPass })
      setStatus('Unlocked.')
      setStatusTone('success')
      next()
    } catch (err: any) {
      setStatus(err?.message || 'Unlock failed.')
      setStatusTone('error')
    }
  }

  return (
    <section className="space-y-6">
      <div className="section-card">
        <h2 className="text-2xl font-semibold">Welcome wizard</h2>
        <p className="text-fog/60 mt-2">Follow the guided setup for Bitcoin remote, LND wallet, and unlock.</p>
        {status && (
          <p className={`mt-4 text-sm ${
            statusTone === 'success'
              ? 'text-glow'
              : statusTone === 'error'
                ? 'text-ember'
                : statusTone === 'warn'
                  ? 'text-brass'
                  : 'text-fog/60'
          }`}>{status}</p>
        )}
      </div>

      {step === 1 && (
        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Step 1: Connect to Bitcoin remote</h3>
          <div className="grid gap-4 lg:grid-cols-3 text-sm text-fog/60">
            <div>
              <p className="uppercase text-xs">RPC Host</p>
              <p>{bitcoinHost || 'bitcoin.br-ln.com:8085'}</p>
            </div>
            <div>
              <p className="uppercase text-xs">ZMQ Raw Block</p>
              <p>{zmqBlock || 'tcp://bitcoin.br-ln.com:28332'}</p>
            </div>
            <div>
              <p className="uppercase text-xs">ZMQ Raw Tx</p>
              <p>{zmqTx || 'tcp://bitcoin.br-ln.com:28333'}</p>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <input className="input-field" placeholder="RPC user" value={rpcUser} onChange={(e) => setRpcUser(e.target.value)} />
            <input className="input-field" placeholder="RPC password" type="password" value={rpcPass} onChange={(e) => setRpcPass(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={handleBitcoin}>Test and save</button>
        </div>
      )}

      {step === 2 && (
        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Step 2: LND wallet</h3>
          <div className="flex gap-3">
            <button className={walletMode === 'create' ? 'btn-primary' : 'btn-secondary'} onClick={() => setWalletMode('create')}>Create new</button>
            <button className={walletMode === 'import' ? 'btn-primary' : 'btn-secondary'} onClick={() => setWalletMode('import')}>Import existing</button>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <input className="input-field" placeholder="Wallet password" type="password" value={walletPassword} onChange={(e) => setWalletPassword(e.target.value)} />
            <input className="input-field" placeholder="Confirm password" type="password" value={walletPasswordConfirm} onChange={(e) => setWalletPasswordConfirm(e.target.value)} />
          </div>
          <p className="text-xs text-fog/60">Password is required to initialize and unlock the wallet. Seed generation does not require it.</p>

          {walletMode === 'create' ? (
            <div className="space-y-3">
              <button className="btn-secondary" onClick={handleGenerateSeed}>Generate seed</button>
              {seedWords.length > 0 && (
                <div className="bg-ink/50 rounded-2xl p-4 text-sm">
                  <p className="text-brass text-xs uppercase">Seed words (write once)</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {seedWords.map((word: string, idx: number) => (
                      <span key={word + idx} className="px-2 py-1 rounded-xl bg-white/5 border border-white/10">{word}</span>
                    ))}
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-xs text-fog/70">
                    <input type="checkbox" checked={ackSeed} onChange={(e) => setAckSeed(e.target.checked)} />
                    I wrote down the 24 words and understand they cannot be recovered.
                  </label>
                </div>
              )}
              <button className="btn-primary" onClick={handleInitWallet}>Initialize wallet</button>
            </div>
          ) : (
            <div className="space-y-3">
              <textarea className="input-field min-h-[120px]" placeholder="Paste 24 seed words" value={seedInput} onChange={(e) => setSeedInput(e.target.value)} />
              <button className="btn-primary" onClick={handleInitWallet}>Import and initialize</button>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Step 3: Unlock existing wallet</h3>
          <input className="input-field" placeholder="Wallet password" type="password" value={unlockPass} onChange={(e) => setUnlockPass(e.target.value)} />
          <button className="btn-primary" onClick={handleUnlock}>Unlock</button>
        </div>
      )}

      {step === 4 && (
        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Step 4: Finish</h3>
          <p className="text-fog/60">Setup complete. Jump to your dashboard.</p>
          <a className="btn-primary inline-flex" href="#dashboard">Go to Dashboard</a>
        </div>
      )}
    </section>
  )
}
