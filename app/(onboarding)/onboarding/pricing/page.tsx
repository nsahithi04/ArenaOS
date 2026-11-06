'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Copy } from 'lucide-react'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
}

const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const totalMins = i * 30
  const h = Math.floor(totalMins / 60)
  const m = totalMins % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${m === 0 ? '00' : '30'} ${ampm}`
})

type PricingRule = {
  id: number
  label: string
  days: string[]
  startTime: string
  endTime: string
  price: string
}

type SportPricing = {
  sportId: string
  sportName: string
  emoji: string
  expanded: boolean
  rules: PricingRule[]
}

function newRule(): PricingRule {
  return { id: Date.now(), label: 'Standard', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], startTime: '6:00 AM', endTime: '10:00 PM', price: '' }
}

export default function PricingPage() {
  const router = useRouter()
  const [sports, setSports] = useState<SportPricing[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/onboarding/venue')
      .then((r) => r.json())
      .then((venue) => {
        if (venue.error) return

        type SavedRule = { id: string; sportId: string | null; label: string; days: string; startTime: string; endTime: string; priceUsd: string }
        const savedRules: SavedRule[] = venue.pricingRules ?? []

        setSports((venue.sports ?? []).map((s: { id: string; name: string; emoji?: string }) => {
          const rules = savedRules
            .filter((r) => r.sportId === s.id)
            .map((r) => ({
              id: Date.now() + Math.random(),
              label: r.label,
              days: r.days.split(',').filter(Boolean),
              startTime: r.startTime,
              endTime: r.endTime,
              price: String(parseFloat(r.priceUsd) || ''),
            }))
          return { sportId: s.id, sportName: s.name, emoji: s.emoji ?? '🏅', expanded: false, rules }
        }))
      })
      .finally(() => setLoading(false))
  }, [])

  const toggleSport = (sportId: string) =>
    setSports((prev) => prev.map((s) => s.sportId === sportId ? { ...s, expanded: !s.expanded } : s))

  const addRule = (sportId: string) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId ? { ...s, rules: [...s.rules, newRule()] } : s
    ))

  const removeRule = (sportId: string, ruleId: number) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId ? { ...s, rules: s.rules.filter((r) => r.id !== ruleId) } : s
    ))

  const updateRule = <K extends keyof PricingRule>(sportId: string, ruleId: number, key: K, val: PricingRule[K]) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId
        ? { ...s, rules: s.rules.map((r) => r.id === ruleId ? { ...r, [key]: val } : r) }
        : s
    ))

  const toggleDay = (sportId: string, ruleId: number, day: string) => {
    setSports((prev) => prev.map((s) => {
      if (s.sportId !== sportId) return s
      return {
        ...s,
        rules: s.rules.map((r) => {
          if (r.id !== ruleId) return r
          const days = r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day]
          return { ...r, days }
        }),
      }
    }))
  }

  const applyFirstToAll = () => {
    if (sports.length === 0) return
    const { rules } = sports[0]
    setSports((prev) => prev.map((s) => ({
      ...s,
      rules: rules.map((r) => ({ ...r, id: Date.now() + Math.random() })),
    })))
  }

  async function handleContinue() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sports: sports.map((s) => ({ sportId: s.sportId, rules: s.rules })),
        }),
      })
      if (!res.ok) { setError((await res.json()).error ?? 'Failed to save'); return }
      router.push('/onboarding/review')
    } catch {
      setError('Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading…</div>

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-foreground">Pricing Setup</h2>
          <p className="text-muted-foreground mt-1 text-sm">Configure pricing rules per sport</p>
        </div>
        {sports.length > 1 && (
          <button onClick={applyFirstToAll}
            className="flex items-center gap-1.5 text-sm text-primary font-medium border border-primary/30 px-3 py-1.5 rounded-lg hover:bg-green-50 transition-colors">
            <Copy size={13} /> Apply {sports[0]?.sportName} pricing to all
          </button>
        )}
      </div>

      <div className="space-y-3">
        {sports.map((sport) => (
          <div key={sport.sportId} className="rounded-xl border border-border bg-white overflow-hidden">
            {/* Sport header */}
            <div onClick={() => toggleSport(sport.sportId)}
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors cursor-pointer">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{sport.emoji}</span>
                <div className="text-left">
                  <p className="text-sm font-semibold text-foreground">{sport.sportName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sport.rules.length === 0 ? 'No rules added' : `${sport.rules.length} pricing rule${sport.rules.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {sport.expanded && (
                  <button type="button" onClick={(e) => { e.stopPropagation(); addRule(sport.sportId) }}
                    className="flex items-center gap-1 text-xs font-medium text-white px-3 py-1.5 rounded-lg hover:opacity-90"
                    style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                    <Plus size={12} /> Add Rule
                  </button>
                )}
                {sport.expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
              </div>
            </div>

            {/* Expanded rules */}
            {sport.expanded && (
              <div className="px-5 pb-5 border-t border-border space-y-4 pt-4">
                {sport.rules.length === 0 && (
                  <div className="text-center py-8 text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
                    No pricing rules yet. Click <span className="text-primary font-medium">"Add Rule"</span> above.
                  </div>
                )}

                {sport.rules.map((rule) => (
                  <div key={rule.id} className="bg-muted/20 rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <input
                        value={rule.label}
                        onChange={(e) => updateRule(sport.sportId, rule.id, 'label', e.target.value)}
                        placeholder="Rule name (e.g. Peak Hours)"
                        className="text-sm font-medium text-foreground bg-transparent outline-none border-b border-transparent focus:border-border flex-1 mr-3"
                      />
                      <button onClick={() => removeRule(sport.sportId, rule.id)}
                        className="w-6 h-6 rounded-lg hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                        <X size={13} />
                      </button>
                    </div>

                    {/* Day selector */}
                    <div className="mb-3">
                      <label className="block text-xs font-medium text-muted-foreground mb-2">Days</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAYS.map((day) => {
                          const selected = rule.days.includes(day)
                          return (
                            <button key={day} type="button"
                              onClick={() => toggleDay(sport.sportId, rule.id, day)}
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                selected
                                  ? 'border-primary bg-green-50 text-primary'
                                  : 'border-border text-muted-foreground hover:border-primary/40'
                              }`}>
                              {DAY_SHORT[day]}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Time + price row */}
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">From</label>
                        <select value={rule.startTime}
                          onChange={(e) => updateRule(sport.sportId, rule.id, 'startTime', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20">
                          {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">To</label>
                        <select value={rule.endTime}
                          onChange={(e) => updateRule(sport.sportId, rule.id, 'endTime', e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20">
                          {TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted-foreground mb-1">Price / hr</label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                          <input type="number" min="0" step="0.50"
                            value={rule.price}
                            onChange={(e) => updateRule(sport.sportId, rule.id, 'price', e.target.value)}
                            placeholder="0.00"
                            className="w-full pl-6 pr-2.5 py-1.5 rounded-lg border border-border bg-white text-xs outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
        <button onClick={() => router.push('/onboarding/courts')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white transition-all">
          <ChevronLeft size={16} /> Back
        </button>
        <button onClick={handleContinue} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          {saving ? 'Saving…' : 'Continue'} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
