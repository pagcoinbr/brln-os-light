import { useEffect, useMemo, useState } from 'react'
import { closeChannel, connectPeer, getLnChannels, openChannel, updateChannelFees } from '../api'

type Channel = {
  channel_point: string
  channel_id: number
  remote_pubkey: string
  peer_alias: string
  active: boolean
  private: boolean
  capacity_sat: number
  local_balance_sat: number
  remote_balance_sat: number
}

export default function LightningOps() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [inactiveCount, setInactiveCount] = useState(0)
  const [status, setStatus] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const [peerAddress, setPeerAddress] = useState('')
  const [peerStatus, setPeerStatus] = useState('')

  const [openPubkey, setOpenPubkey] = useState('')
  const [openAmount, setOpenAmount] = useState('')
  const [openPush, setOpenPush] = useState('')
  const [openPrivate, setOpenPrivate] = useState(false)
  const [openStatus, setOpenStatus] = useState('')

  const [closePoint, setClosePoint] = useState('')
  const [closeForce, setCloseForce] = useState(false)
  const [closeStatus, setCloseStatus] = useState('')

  const [feeScopeAll, setFeeScopeAll] = useState(true)
  const [feeChannelPoint, setFeeChannelPoint] = useState('')
  const [baseFeeMsat, setBaseFeeMsat] = useState('')
  const [feeRatePpm, setFeeRatePpm] = useState('')
  const [timeLockDelta, setTimeLockDelta] = useState('')
  const [feeStatus, setFeeStatus] = useState('')

  const load = async () => {
    setStatus('Loading channels...')
    try {
      const res = await getLnChannels()
      const list = Array.isArray(res?.channels) ? res.channels : []
      setChannels(list)
      setActiveCount(res?.active_count ?? 0)
      setInactiveCount(res?.inactive_count ?? 0)
      setStatus('')
    } catch (err: any) {
      setStatus(err?.message || 'Failed to load channels.')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filteredChannels = useMemo(() => {
    if (filter === 'active') {
      return channels.filter((ch) => ch.active)
    }
    if (filter === 'inactive') {
      return channels.filter((ch) => !ch.active)
    }
    return channels
  }, [channels, filter])

  const handleConnectPeer = async () => {
    setPeerStatus('Connecting...')
    try {
      await connectPeer({ address: peerAddress })
      setPeerStatus('Peer connected.')
      setPeerAddress('')
      load()
    } catch (err: any) {
      setPeerStatus(err?.message || 'Peer connection failed.')
    }
  }

  const handleOpenChannel = async () => {
    setOpenStatus('Opening channel...')
    const localFunding = Number(openAmount || 0)
    const push = Number(openPush || 0)
    if (!openPubkey.trim()) {
      setOpenStatus('Pubkey required.')
      return
    }
    if (localFunding < 20000) {
      setOpenStatus('Minimum channel size is 20000 sat.')
      return
    }
    try {
      const res = await openChannel({
        pubkey: openPubkey.trim(),
        local_funding_sat: localFunding,
        push_sat: push > 0 ? push : 0,
        private: openPrivate
      })
      setOpenStatus(`Channel opening: ${res?.channel_point || 'submitted'}`)
      setOpenAmount('')
      setOpenPush('')
      load()
    } catch (err: any) {
      setOpenStatus(err?.message || 'Channel open failed.')
    }
  }

  const handleCloseChannel = async () => {
    setCloseStatus('Closing channel...')
    if (!closePoint) {
      setCloseStatus('Select a channel to close.')
      return
    }
    try {
      await closeChannel({ channel_point: closePoint, force: closeForce })
      setCloseStatus('Close initiated.')
      load()
    } catch (err: any) {
      setCloseStatus(err?.message || 'Close failed.')
    }
  }

  const handleUpdateFees = async () => {
    setFeeStatus('Updating fees...')
    const base = Number(baseFeeMsat || 0)
    const ppm = Number(feeRatePpm || 0)
    const delta = Number(timeLockDelta || 0)
    if (!feeScopeAll && !feeChannelPoint) {
      setFeeStatus('Select a channel or apply to all.')
      return
    }
    if (base === 0 && ppm === 0 && delta === 0) {
      setFeeStatus('Set at least one fee value.')
      return
    }
    try {
      await updateChannelFees({
        apply_all: feeScopeAll,
        channel_point: feeScopeAll ? undefined : feeChannelPoint,
        base_fee_msat: base,
        fee_rate_ppm: ppm,
        time_lock_delta: delta
      })
      setFeeStatus('Fees updated.')
      load()
    } catch (err: any) {
      setFeeStatus(err?.message || 'Fee update failed.')
    }
  }

  const channelOptions = useMemo(() => {
    return channels.map((ch) => ({
      value: ch.channel_point,
      label: `${ch.peer_alias || ch.remote_pubkey.slice(0, 12)} • ${ch.channel_point}`
    }))
  }, [channels])

  return (
    <section className="space-y-6">
      <div className="section-card">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Lightning Ops</h2>
            <p className="text-fog/60">Manage peers, channels, and routing fees.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-white/10 bg-ink/60 px-4 py-2 text-xs text-fog/70">
              Active: <span className="text-fog">{activeCount}</span>
            </div>
            <div className="rounded-full border border-white/10 bg-ink/60 px-4 py-2 text-xs text-fog/70">
              Inactive: <span className="text-fog">{inactiveCount}</span>
            </div>
            <button className="btn-secondary text-xs px-3 py-2" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
        {status && <p className="mt-4 text-sm text-brass">{status}</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Add peer</h3>
          <input
            className="input-field"
            placeholder="pubkey@host:port"
            value={peerAddress}
            onChange={(e) => setPeerAddress(e.target.value)}
          />
          <button className="btn-primary" onClick={handleConnectPeer}>Connect peer</button>
          {peerStatus && <p className="text-sm text-brass">{peerStatus}</p>}
        </div>

        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Open channel</h3>
          <input
            className="input-field"
            placeholder="Peer pubkey (hex)"
            value={openPubkey}
            onChange={(e) => setOpenPubkey(e.target.value)}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <input
              className="input-field"
              placeholder="Funding amount (sat)"
              type="number"
              min={20000}
              value={openAmount}
              onChange={(e) => setOpenAmount(e.target.value)}
            />
            <input
              className="input-field"
              placeholder="Push amount (sat, optional)"
              type="number"
              min={0}
              value={openPush}
              onChange={(e) => setOpenPush(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-fog/70">
            <input type="checkbox" checked={openPrivate} onChange={(e) => setOpenPrivate(e.target.checked)} />
            Private channel
          </label>
          <button className="btn-primary" onClick={handleOpenChannel}>Open channel</button>
          <p className="text-xs text-fog/50">Minimum funding is 20000 sat. Opening a channel can take a few blocks.</p>
          {openStatus && <p className="text-sm text-brass">{openStatus}</p>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Close channel</h3>
          <select className="input-field" value={closePoint} onChange={(e) => setClosePoint(e.target.value)}>
            <option value="">Select channel</option>
            {channelOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-fog/70">
            <input type="checkbox" checked={closeForce} onChange={(e) => setCloseForce(e.target.checked)} />
            Force close (not recommended)
          </label>
          <button className="btn-secondary" onClick={handleCloseChannel}>Close channel</button>
          {closeStatus && <p className="text-sm text-brass">{closeStatus}</p>}
        </div>

        <div className="section-card space-y-4">
          <h3 className="text-lg font-semibold">Update channel fees</h3>
          <div className="flex flex-wrap gap-3 text-sm">
            <button
              className={feeScopeAll ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setFeeScopeAll(true)}
            >
              Apply to all
            </button>
            <button
              className={!feeScopeAll ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setFeeScopeAll(false)}
            >
              Apply to one
            </button>
          </div>
          {!feeScopeAll && (
            <select className="input-field" value={feeChannelPoint} onChange={(e) => setFeeChannelPoint(e.target.value)}>
              <option value="">Select channel</option>
              {channelOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            <input
              className="input-field"
              placeholder="Base fee (msat)"
              type="number"
              min={0}
              value={baseFeeMsat}
              onChange={(e) => setBaseFeeMsat(e.target.value)}
            />
            <input
              className="input-field"
              placeholder="Fee rate (ppm)"
              type="number"
              min={0}
              value={feeRatePpm}
              onChange={(e) => setFeeRatePpm(e.target.value)}
            />
            <input
              className="input-field"
              placeholder="Timelock delta"
              type="number"
              min={0}
              value={timeLockDelta}
              onChange={(e) => setTimeLockDelta(e.target.value)}
            />
          </div>
          <button className="btn-secondary" onClick={handleUpdateFees}>Update fees</button>
          {feeStatus && <p className="text-sm text-brass">{feeStatus}</p>}
        </div>
      </div>

      <div className="section-card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold">Channels</h3>
          <div className="flex gap-2 text-xs">
            <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>All</button>
            <button className={filter === 'active' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('active')}>Active</button>
            <button className={filter === 'inactive' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('inactive')}>Inactive</button>
          </div>
        </div>
        {filteredChannels.length ? (
          <div className="grid gap-3">
            {filteredChannels.map((ch) => (
              <div key={ch.channel_point} className="rounded-2xl border border-white/10 bg-ink/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-fog/60">{ch.peer_alias || ch.remote_pubkey}</p>
                    <p className="text-xs text-fog/50">Point: {ch.channel_point}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs ${ch.active ? 'bg-glow/20 text-glow' : 'bg-ember/20 text-ember'}`}>
                    {ch.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-3 text-xs text-fog/70">
                  <div>Capacity: <span className="text-fog">{ch.capacity_sat} sat</span></div>
                  <div>Local: <span className="text-fog">{ch.local_balance_sat} sat</span></div>
                  <div>Remote: <span className="text-fog">{ch.remote_balance_sat} sat</span></div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fog/60">No channels found.</p>
        )}
      </div>
    </section>
  )
}
