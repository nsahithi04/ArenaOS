'use client'

// Pick an existing player (search) or enter a new one. Used when selling
// memberships, enrolling students, and choosing a member for a booking.

import { useEffect, useState } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { api, fmtDate, inputCls, Spinner, type BookingContext } from '@/components/bookings/shared'

export type PlayerHit = {
  id: string
  name: string
  phone: string | null
  email: string | null
  membership: { id: string; planName: string; sportId: string | null; endDate: string } | null
}

export type PlayerChoice =
  | { kind: 'existing'; player: PlayerHit }
  | { kind: 'new'; name: string; phone: string; email: string }
  | null

/** Request body fragment for the APIs: { playerId } or { newPlayer }. */
export function playerPayload(c: PlayerChoice) {
  if (!c) return {}
  if (c.kind === 'existing') return { playerId: c.player.id }
  return { newPlayer: { name: c.name.trim(), phone: c.phone.trim() || null, email: c.email.trim() || null } }
}

export function PlayerPicker({ ctx, value, onChange, membersOnly, date, allowNew = true, label = 'Player' }: {
  ctx: BookingContext
  value: PlayerChoice
  onChange: (c: PlayerChoice) => void
  /** Only show players with a membership valid on `date`. */
  membersOnly?: boolean
  date?: string
  allowNew?: boolean
  label?: string
}) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (value) return
    const t = setTimeout(() => {
      const p = new URLSearchParams({ venueId: ctx.venue.id })
      if (q.trim()) p.set('q', q.trim())
      if (membersOnly) p.set('membersOnly', '1')
      if (date) p.set('date', date)
      setLoading(true)
      api<PlayerHit[]>(`/api/players?${p}`).then(setHits).catch(() => setHits([])).finally(() => setLoading(false))
    }, 250)
    return () => clearTimeout(t)
  }, [q, membersOnly, date, value, ctx.venue.id])

  if (value?.kind === 'existing') {
    const p = value.player
    return (
      <div>
        <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{p.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {[p.phone, p.membership && `${p.membership.planName} · until ${fmtDate(p.membership.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`].filter(Boolean).join(' · ') || 'No contact details'}
            </p>
          </div>
          <button type="button" onClick={() => onChange(null)} aria-label="Change player" className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><X size={14} /></button>
        </div>
      </div>
    )
  }

  if (value?.kind === 'new') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">New {label.toLowerCase()}</label>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-primary hover:underline">Search existing instead</button>
        </div>
        <input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} maxLength={120} placeholder="Full name *" className={inputCls} autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <input value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} maxLength={30} inputMode="tel" placeholder="Phone" className={inputCls} />
          <input value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} maxLength={254} type="email" placeholder="Email" className={inputCls} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={membersOnly ? 'Search members by name or phone…' : 'Search players by name or phone…'} className={`${inputCls} pl-8`} />
        {loading && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />}
      </div>
      <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border">
        {hits.map((p) => (
          <button key={p.id} type="button" onClick={() => onChange({ kind: 'existing', player: p })} className="w-full text-left px-3 py-2 hover:bg-muted/40">
            <p className="text-sm font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">{[p.phone, p.membership ? `${p.membership.planName} until ${fmtDate(p.membership.endDate, { month: 'short', day: 'numeric' })}` : null].filter(Boolean).join(' · ') || '—'}</p>
          </button>
        ))}
        {!loading && hits.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">{membersOnly ? 'No member with a membership valid on this date.' : q ? 'No players found.' : 'No players yet.'}</p>
        )}
        {allowNew && (
          <button type="button" onClick={() => onChange({ kind: 'new', name: q, phone: '', email: '' })} className="w-full text-left px-3 py-2 hover:bg-green-50 text-sm text-primary flex items-center gap-2">
            <UserPlus size={14} /> New {label.toLowerCase()}{q ? `: “${q}”` : ''}
          </button>
        )}
      </div>
    </div>
  )
}
