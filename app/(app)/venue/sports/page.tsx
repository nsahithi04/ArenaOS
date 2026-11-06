'use client'

import { useEffect, useState } from 'react'
import { Check, Plus, X, Save } from 'lucide-react'

const COMMON_SPORTS = [
  { id: 'badminton',   label: 'Badminton',   emoji: '🏸' },
  { id: 'tennis',      label: 'Tennis',       emoji: '🎾' },
  { id: 'pickleball',  label: 'Pickleball',   emoji: '🏓' },
  { id: 'basketball',  label: 'Basketball',   emoji: '🏀' },
  { id: 'soccer',      label: 'Soccer',       emoji: '⚽' },
  { id: 'volleyball',  label: 'Volleyball',   emoji: '🏐' },
  { id: 'tabletennis', label: 'Table Tennis', emoji: '🏓' },
  { id: 'padel',       label: 'Padel',        emoji: '🎾' },
  { id: 'squash',      label: 'Squash',       emoji: '🎯' },
]

type CustomSport = { label: string; emoji: string }

export default function SportsSettingsPage() {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [custom, setCustom] = useState<CustomSport[]>([])
  const [customInput, setCustomInput] = useState('')
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
        const savedSports: { name: string; emoji: string }[] = venue.sports ?? []
        const savedNames = savedSports.map((s) => s.name.toLowerCase())
        const preSelected = COMMON_SPORTS.filter((s) => savedNames.includes(s.label.toLowerCase())).map((s) => s.id)
        setSelected(preSelected)
        const knownNames = new Set(COMMON_SPORTS.map((s) => s.label.toLowerCase()))
        setCustom(savedSports.filter((s) => !knownNames.has(s.name.toLowerCase())).map((s) => ({ label: s.name, emoji: s.emoji || '🏅' })))
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const toggle = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id])

  const addCustom = () => {
    const name = customInput.trim()
    if (!name) return
    if (custom.some((c) => c.label.toLowerCase() === name.toLowerCase())) return
    setCustom((prev) => [...prev, { label: name, emoji: '🏅' }])
    setCustomInput('')
  }

  async function handleSave() {
    if (!venueId) return
    setError(''); setSaving(true)
    try {
      const selectedSports = selected.map((id) => {
        const s = COMMON_SPORTS.find((sp) => sp.id === id)!
        return { name: s.label, emoji: s.emoji }
      })
      const res = await fetch(`/api/venues/${venueId}/sports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sports: [...selectedSports, ...custom] }),
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
          <h1 className="text-xl font-semibold text-foreground">Sports</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Select which sports your venue supports</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving…' : <><Save size={14} /> Save</>}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="bg-white rounded-xl border border-border p-5 mb-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Common Sports</p>
        <div className="grid grid-cols-3 gap-2.5">
          {COMMON_SPORTS.map((sport) => {
            const active = selected.includes(sport.id)
            return (
              <button key={sport.id} onClick={() => toggle(sport.id)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-sm font-medium transition-all ${active ? 'border-green-500 bg-green-50 text-green-700' : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
                {active && <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-green-500 text-white flex items-center justify-center"><Check size={10} /></div>}
                <span className="text-2xl">{sport.emoji}</span>
                <span>{sport.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Other Sports</p>
        {custom.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {custom.map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 border border-green-200 text-sm font-medium text-green-700">
                {c.emoji} {c.label}
                <button onClick={() => setCustom((prev) => prev.filter((x) => x.label !== c.label))}><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={customInput} onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
            placeholder="e.g. Cricket, Hockey…"
            className="flex-1 px-3 py-2 rounded-lg border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
          <button onClick={addCustom} className="px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"><Plus size={16} /></button>
        </div>
      </div>
    </div>
  )
}
