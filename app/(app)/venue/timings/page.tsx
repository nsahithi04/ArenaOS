'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Save, Check } from 'lucide-react'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const ENUM_TO_DAY: Record<string, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor((i * 30) / 60)
  const m = (i * 30) % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${m === 0 ? '00' : '30'} ${ampm}`
})

type DayRow = { day: string; open: string; close: string; isClosed: boolean }
type SportHours = { sportId: string; sportName: string; emoji: string; expanded: boolean; days: DayRow[] }

const defaultDays = (): DayRow[] =>
  DAYS.map((day) => ({ day, open: '6:00 AM', close: '10:00 PM', isClosed: false }))

export default function TimingsSettingsPage() {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [sports, setSports] = useState<SportHours[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/venues')
      .then((r) => r.json())
      .then((venues) => {
        const venue = venues[0]
        if (!venue) return
        setVenueId(venue.id)

        type SavedHour = { sportId: string | null; day: string; openTime: string; closeTime: string; isClosed: boolean }
        const savedHours: SavedHour[] = venue.operatingHours ?? []

        setSports(
          (venue.sports ?? []).map((s: { id: string; name: string; emoji?: string }) => {
            const sportHours = savedHours.filter((h) => h.sportId === s.id)
            const days = defaultDays().map((d) => {
              const saved = sportHours.find((h) => ENUM_TO_DAY[h.day] === d.day)
              return saved ? { day: d.day, open: saved.openTime, close: saved.closeTime, isClosed: saved.isClosed } : d
            })
            return { sportId: s.id, sportName: s.name, emoji: s.emoji ?? '🏅', expanded: false, days }
          })
        )
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const toggleSport = (id: string) =>
    setSports((prev) => prev.map((s) => s.sportId === id ? { ...s, expanded: !s.expanded } : s))

  const updateDay = (sportId: string, idx: number, patch: Partial<DayRow>) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId ? { ...s, days: s.days.map((d, i) => i === idx ? { ...d, ...patch } : d) } : s
    ))

  const applyMonToSport = (sportId: string) =>
    setSports((prev) => prev.map((s) => {
      if (s.sportId !== sportId) return s
      const { open, close } = s.days[0]
      return { ...s, days: s.days.map((d) => ({ ...d, open, close })) }
    }))

  const applyFirstToAll = () => {
    if (!sports.length) return
    const { days } = sports[0]
    setSports((prev) => prev.map((s) => ({
      ...s,
      days: days.map((d, i) => ({ day: s.days[i].day, open: d.open, close: d.close, isClosed: d.isClosed })),
    })))
  }

  async function handleSave() {
    if (!venueId) return
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/venues/${venueId}/hours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sports: sports.map((s) => ({ sportId: s.sportId, hours: s.days })) }),
      })
      if (!res.ok) { setError((await res.json()).error ?? 'Save failed'); return }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch { setError('Something went wrong.') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Timings</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Set operating hours per sport</p>
        </div>
        <div className="flex items-center gap-2">
          {sports.length > 1 && (
            <button onClick={applyFirstToAll}
              className="flex items-center gap-1.5 text-xs text-primary font-medium border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
              <Copy size={12} /> Apply {sports[0]?.sportName} to all
            </button>
          )}
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
            {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving…' : <><Save size={14} /> Save</>}
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {sports.length === 0 ? (
        <div className="text-center py-20 text-sm text-muted-foreground">No sports configured yet. Add sports first.</div>
      ) : (
        <div className="space-y-3">
          {sports.map((sport) => (
            <div key={sport.sportId} className="rounded-xl border border-border bg-white overflow-hidden">
              <button type="button" onClick={() => toggleSport(sport.sportId)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{sport.emoji}</span>
                  <div className="text-left">
                    <p className="text-sm font-semibold">{sport.sportName}</p>
                    {!sport.expanded && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {sport.days.filter((d) => !d.isClosed).length} days open · {sport.days[0].open} – {sport.days[0].close}
                      </p>
                    )}
                  </div>
                </div>
                {sport.expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
              </button>

              {sport.expanded && (
                <div className="px-5 pb-5 border-t border-border">
                  <div className="flex justify-end pt-3 pb-2">
                    <button type="button" onClick={() => applyMonToSport(sport.sportId)}
                      className="text-xs text-primary font-medium border border-primary/30 px-2.5 py-1 rounded-lg hover:bg-green-50 transition-colors">
                      Apply Monday to all days
                    </button>
                  </div>
                  <div className="space-y-2">
                    {sport.days.map((h, i) => (
                      <div key={h.day} className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${h.isClosed ? 'opacity-50 bg-muted/20' : 'bg-white'}`}>
                        <div className="w-20 flex-shrink-0">
                          <p className="text-xs font-semibold">{h.day.slice(0, 3)}</p>
                          <p className="text-xs text-muted-foreground">{h.day}</p>
                        </div>
                        <div className="flex-1 flex items-center gap-2">
                          <select disabled={h.isClosed} value={h.open} onChange={(e) => updateDay(sport.sportId, i, { open: e.target.value })}
                            className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50">
                            {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                          </select>
                          <span className="text-muted-foreground text-xs">to</span>
                          <select disabled={h.isClosed} value={h.close} onChange={(e) => updateDay(sport.sportId, i, { close: e.target.value })}
                            className="flex-1 px-2 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50">
                            {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-muted-foreground">Closed</span>
                          <button type="button" onClick={() => updateDay(sport.sportId, i, { isClosed: !h.isClosed })}
                            className={`relative w-9 h-5 rounded-full transition-colors ${h.isClosed ? 'bg-red-400' : 'bg-muted'}`}>
                            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${h.isClosed ? 'left-4' : 'left-0.5'}`} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
