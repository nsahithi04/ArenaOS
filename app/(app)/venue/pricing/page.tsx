'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp, Save, Check } from 'lucide-react'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL: Record<string, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday',
  Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor((i * 30) / 60)
  const m = (i * 30) % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${m === 0 ? '00' : '30'} ${ampm}`
})

type PricingRule = { id: number; label: string; days: string[]; startTime: string; endTime: string; price: string }
type SportPricing = { sportId: string; sportName: string; emoji: string; expanded: boolean; rules: PricingRule[] }

const newRule = (): PricingRule => ({
  id: Date.now() + Math.random(),
  label: 'Standard Rate',
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  startTime: '6:00 AM',
  endTime: '10:00 PM',
  price: '',
})

export default function PricingSettingsPage() {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [sports, setSports] = useState<SportPricing[]>([])
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

        type SavedRule = { sportId: string | null; label: string; days: string; startTime: string; endTime: string; priceUsd: number }
        const savedRules: SavedRule[] = venue.pricingRules ?? []

        const DAY_ABBR: Record<string, string> = {
          Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
          Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
        }

        setSports(
          (venue.sports ?? []).map((s: { id: string; name: string; emoji?: string }) => {
            const sportRules = savedRules.filter((r) => r.sportId === s.id)
            const rules: PricingRule[] = sportRules.map((r) => ({
              id: Date.now() + Math.random(),
              label: r.label,
              days: (r.days ?? '').split(',').map((d) => DAY_ABBR[d.trim()] ?? d.trim()).filter(Boolean),
              startTime: r.startTime,
              endTime: r.endTime,
              price: String(r.priceUsd ?? ''),
            }))
            return { sportId: s.id, sportName: s.name, emoji: s.emoji ?? '🏅', expanded: false, rules }
          })
        )
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const toggleSport = (id: string) =>
    setSports((prev) => prev.map((s) => s.sportId === id ? { ...s, expanded: !s.expanded } : s))

  const addRule = (sportId: string) =>
    setSports((prev) => prev.map((s) => s.sportId === sportId ? { ...s, rules: [...s.rules, newRule()] } : s))

  const removeRule = (sportId: string, ruleId: number) =>
    setSports((prev) => prev.map((s) => s.sportId === sportId ? { ...s, rules: s.rules.filter((r) => r.id !== ruleId) } : s))

  const updateRule = <K extends keyof PricingRule>(sportId: string, ruleId: number, key: K, value: PricingRule[K]) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId
        ? { ...s, rules: s.rules.map((r) => r.id === ruleId ? { ...r, [key]: value } : r) }
        : s
    ))

  const toggleDay = (sportId: string, ruleId: number, day: string) => {
    setSports((prev) => prev.map((s) => {
      if (s.sportId !== sportId) return s
      return {
        ...s, rules: s.rules.map((r) => {
          if (r.id !== ruleId) return r
          const days = r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day]
          return { ...r, days }
        }),
      }
    }))
  }

  async function handleSave() {
    if (!venueId) return
    setError(''); setSaving(true)
    try {
      const payload = sports.map((s) => ({
        sportId: s.sportId,
        rules: s.rules.map((r) => ({
          label: r.label,
          days: r.days.map((d) => DAY_FULL[d] ?? d),
          startTime: r.startTime,
          endTime: r.endTime,
          price: r.price,
        })),
      }))
      const res = await fetch(`/api/venues/${venueId}/pricing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sports: payload }),
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
          <h1 className="text-xl font-semibold text-foreground">Pricing</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Set pricing rules per sport and time slot</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving…' : <><Save size={14} /> Save</>}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {sports.length === 0 ? (
        <div className="text-center py-20 text-sm text-muted-foreground">No sports configured. Add sports first.</div>
      ) : (
        <div className="space-y-3">
          {sports.map((sport) => (
            <div key={sport.sportId} className="rounded-xl border border-border bg-white overflow-hidden">
              <div onClick={() => toggleSport(sport.sportId)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{sport.emoji}</span>
                  <div className="text-left">
                    <p className="text-sm font-semibold">{sport.sportName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {sport.rules.length === 0 ? 'No pricing rules' : `${sport.rules.length} rule${sport.rules.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sport.expanded && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); addRule(sport.sportId) }}
                      className="flex items-center gap-1 text-xs font-medium text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-all"
                      style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                      <Plus size={12} /> Add Rule
                    </button>
                  )}
                  {sport.expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </div>
              </div>

              {sport.expanded && (
                <div className="px-5 pb-5 border-t border-border space-y-4 pt-4">
                  {sport.rules.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
                      No rules yet. Click <span className="text-primary font-medium">"Add Rule"</span> above.
                    </div>
                  )}
                  {sport.rules.map((rule) => (
                    <div key={rule.id} className="bg-muted/20 rounded-xl border border-border p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <input value={rule.label}
                          onChange={(e) => updateRule(sport.sportId, rule.id, 'label', e.target.value)}
                          placeholder="e.g. Peak Hours, Standard Rate"
                          className="flex-1 mr-2 px-3 py-1.5 rounded-lg border border-border bg-white text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                        <button onClick={() => removeRule(sport.sportId, rule.id)}
                          className="w-6 h-6 rounded-lg hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Day toggles */}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Days</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {DAYS.map((d) => (
                            <button key={d} type="button" onClick={() => toggleDay(sport.sportId, rule.id, d)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${rule.days.includes(d) ? 'border-primary bg-green-50 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Time + price */}
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Start</label>
                          <select value={rule.startTime} onChange={(e) => updateRule(sport.sportId, rule.id, 'startTime', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20">
                            {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">End</label>
                          <select value={rule.endTime} onChange={(e) => updateRule(sport.sportId, rule.id, 'endTime', e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20">
                            {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Price / hour ($)</label>
                          <input type="number" min="0" step="0.01" value={rule.price}
                            onChange={(e) => updateRule(sport.sportId, rule.id, 'price', e.target.value)}
                            placeholder="0.00"
                            className="w-full px-3 py-1.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
