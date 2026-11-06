'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Check, ChevronLeft, ChevronRight } from 'lucide-react'

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

export default function SportsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/onboarding/venue')
      .then((r) => r.json())
      .then((venue) => {
        if (venue.error) return
        const savedNames: string[] = (venue.sports ?? []).map((s: { name: string }) => s.name.toLowerCase())
        const preSelected = COMMON_SPORTS
          .filter((s) => savedNames.includes(s.label.toLowerCase()))
          .map((s) => s.id)
        setSelected(preSelected)
      })
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [])

  const toggle = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id])

  async function handleContinue() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/onboarding/sports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sports: selected.map((id) => {
            const s = COMMON_SPORTS.find((sp) => sp.id === id)
            return { name: s!.label, emoji: s!.emoji }
          }),
        }),
      })
      if (!res.ok) { setError((await res.json()).error ?? 'Failed to save'); return }
      router.push('/onboarding/hours')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading…</div>

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Sports Offered</h2>
        <p className="text-muted-foreground mt-1 text-sm">Select all sports available at your facility</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {COMMON_SPORTS.map((sport) => {
          const isSelected = selected.includes(sport.id)
          return (
            <button key={sport.id} type="button" onClick={() => toggle(sport.id)}
              className={`relative flex flex-col items-center gap-2 py-5 px-3 rounded-xl border-2 transition-all ${isSelected ? 'border-primary bg-green-50' : 'border-border hover:border-primary/40 bg-white'}`}>
              {isSelected && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                  <Check size={11} className="text-white" />
                </div>
              )}
              <span className="text-3xl">{sport.emoji}</span>
              <span className={`text-sm font-medium ${isSelected ? 'text-primary' : 'text-foreground'}`}>{sport.label}</span>
            </button>
          )
        })}

        <button type="button"
          className="flex flex-col items-center gap-2 py-5 px-3 rounded-xl border-2 border-dashed border-border hover:border-primary/40 bg-white transition-all">
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <Plus size={18} className="text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-muted-foreground">Add Custom</span>
        </button>
      </div>

      {selected.length > 0 && (
        <div className="mt-5 p-3 rounded-lg bg-green-50 border border-green-100">
          <p className="text-sm text-green-700 font-medium">
            {selected.length} sport{selected.length > 1 ? 's' : ''} selected:{' '}
            <span className="font-normal">{selected.map((id) => COMMON_SPORTS.find((s) => s.id === id)?.label).join(', ')}</span>
          </p>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
        <button onClick={() => router.push('/onboarding/facility')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white transition-all">
          <ChevronLeft size={16} /> Back
        </button>
        <button onClick={handleContinue} disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          {loading ? 'Saving…' : 'Continue'} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
