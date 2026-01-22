import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDisk } from '../api'
import { getLocale } from '../i18n'

export default function Disks() {
  const { t, i18n } = useTranslation()
  const locale = getLocale(i18n.language)
  const gbFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const percentFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const [disks, setDisks] = useState<any[]>([])

  useEffect(() => {
    getDisk()
      .then((data) => setDisks(Array.isArray(data) ? data : []))
      .catch(() => null)
  }, [])

  const formatGB = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-'
    return `${gbFormatter.format(value)} GB`
  }

  const formatPercent = (value?: number) => {
    if (typeof value !== 'number' || Number.isNaN(value)) return '-'
    return percentFormatter.format(value)
  }

  return (
    <section className="space-y-6">
      <div className="section-card">
        <h2 className="text-2xl font-semibold">{t('disks.title')}</h2>
        <p className="text-fog/60">{t('disks.subtitle')}</p>
      </div>

      <div className="section-card space-y-4">
        {disks.length ? (
          disks.map((disk) => {
            const totalLabel = formatGB(disk.total_gb)
            const usedLabel = formatGB(disk.used_gb)
            const percentLabel = formatPercent(disk.used_percent)
            const partitions = Array.isArray(disk.partitions) ? disk.partitions : []
            return (
            <div key={disk.device} className="border border-white/10 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fog/60">{disk.device}</p>
                  <p className="text-lg font-semibold">{disk.type}</p>
                </div>
                <div className="text-sm text-fog/70">{t('disks.smartLabel', { status: disk.smart_status })}</div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-5 text-sm">
                <div>
                  <p className="text-fog/60">{t('disks.wear')}</p>
                  <p>{disk.wear_percent_used}%</p>
                </div>
                <div>
                  <p className="text-fog/60">{t('disks.powerOnHours')}</p>
                  <p>{disk.power_on_hours}</p>
                </div>
                <div>
                  <p className="text-fog/60">{t('disks.daysLeft')}</p>
                  <p>{disk.days_left_estimate}</p>
                </div>
                <div>
                  <p className="text-fog/60">{t('disks.size')}</p>
                  <p>{totalLabel}</p>
                </div>
                <div>
                  <p className="text-fog/60">{t('disks.used')}</p>
                  <p>{t('disks.usedValue', { used: usedLabel, percent: percentLabel })}</p>
                </div>
              </div>
              {disk.alerts?.length ? (
                <p className="mt-2 text-xs text-ember">{t('disks.alerts', { alerts: disk.alerts.join(', ') })}</p>
              ) : (
                <p className="mt-2 text-xs text-fog/50">{t('disks.noAlerts')}</p>
              )}
              {partitions.length > 0 && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <p className="text-xs uppercase tracking-wide text-fog/50">{t('disks.partitions')}</p>
                  <div className="mt-2 space-y-2">
                    {partitions.map((part: any) => {
                      const partTotal = formatGB(part.total_gb)
                      const partUsed = formatGB(part.used_gb)
                      const partPercent = formatPercent(part.used_percent)
                      return (
                        <div key={part.device} className="flex flex-wrap items-center justify-between gap-2 text-xs text-fog/60">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-fog/70">{part.device}</span>
                            {part.mount && <span className="text-fog/50">{part.mount}</span>}
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <span>{t('disks.size')}: {partTotal}</span>
                            <span>{t('disks.used')}: {t('disks.usedValue', { used: partUsed, percent: partPercent })}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )})
        ) : (
          <p className="text-fog/60">{t('disks.noData')}</p>
        )}
      </div>
    </section>
  )
}
