'use client'

import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Building2, ChevronDown, ChevronUp, ImageIcon, X, Save, Check } from 'lucide-react'

type CourtImage = { preview: string; url: string | null; uploading: boolean }

type CourtRow = {
  id: number
  dbId?: string // database id of a saved court; lets the API update instead of recreate
  name: string
  type: 'Indoor' | 'Outdoor'
  capacity: number
  description: string
  images: CourtImage[]
}

type SportCourts = {
  sportId: string
  sportName: string
  emoji: string
  expanded: boolean
  courts: CourtRow[]
}

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Upload failed')
  return (await res.json()).url as string
}

function CourtImageRow({ courtId, images, onAdd, onRemove }: {
  courtId: number
  images: CourtImage[]
  onAdd: (courtId: number, img: CourtImage) => void
  onRemove: (courtId: number, preview: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    const preview = URL.createObjectURL(file)
    onAdd(courtId, { preview, url: null, uploading: true })
    try {
      const url = await uploadFile(file)
      onAdd(courtId, { preview, url, uploading: false })
    } catch {
      onAdd(courtId, { preview, url: null, uploading: false })
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">Court Photos</label>
      <div className="flex flex-wrap gap-2">
        {images.map((img) => (
          <div key={img.preview} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.preview} alt="" className="w-full h-full object-cover" />
            {img.uploading ? (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <button type="button" onClick={() => onRemove(courtId, img.preview)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center">
                <X size={8} />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => inputRef.current?.click()}
          className="w-16 h-16 border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center gap-1 hover:border-primary/40 transition-colors cursor-pointer bg-muted/20">
          <ImageIcon size={13} className="text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground">Add</span>
        </button>
        <input ref={inputRef} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => Array.from(e.target.files ?? []).forEach(handleFile)} />
      </div>
    </div>
  )
}

export default function CourtsSettingsPage() {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [sports, setSports] = useState<SportCourts[]>([])
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

        type SavedCourt = { id: string; sportId: string | null; name: string; type: string; capacity: number; description: string | null; images: string[]; isActive: boolean }
        // Deactivated courts (removed but still referenced by bookings) stay hidden.
        const savedCourts: SavedCourt[] = (venue.courts ?? []).filter((c: SavedCourt) => c.isActive !== false)

        setSports(
          (venue.sports ?? []).map((s: { id: string; name: string; emoji?: string }) => {
            const courts = savedCourts
              .filter((c) => c.sportId === s.id)
              .map((c) => ({
                id: Date.now() + Math.random(),
                dbId: c.id,
                name: c.name,
                type: (c.type === 'OUTDOOR' ? 'Outdoor' : 'Indoor') as 'Indoor' | 'Outdoor',
                capacity: c.capacity,
                description: c.description ?? '',
                images: (c.images ?? []).map((url: string) => ({ preview: url, url, uploading: false })),
              }))
            return { sportId: s.id, sportName: s.name, emoji: s.emoji ?? '🏅', expanded: false, courts }
          })
        )
      })
      .catch(() => setError('Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const toggleSport = (sportId: string) =>
    setSports((prev) => prev.map((s) => s.sportId === sportId ? { ...s, expanded: !s.expanded } : s))

  const addCourt = (sportId: string) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId
        ? { ...s, courts: [...s.courts, { id: Date.now(), name: `Court ${s.courts.length + 1}`, type: 'Indoor', capacity: 4, description: '', images: [] }] }
        : s
    ))

  const removeCourt = (sportId: string, courtId: number) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId ? { ...s, courts: s.courts.filter((c) => c.id !== courtId) } : s
    ))

  const updateCourt = <K extends keyof CourtRow>(sportId: string, courtId: number, key: K, value: CourtRow[K]) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId
        ? { ...s, courts: s.courts.map((c) => c.id === courtId ? { ...c, [key]: value } : c) }
        : s
    ))

  const addCourtImage = (sportId: string, courtId: number, img: CourtImage) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId
        ? {
            ...s, courts: s.courts.map((c) => {
              if (c.id !== courtId) return c
              const existing = c.images.find((i) => i.preview === img.preview)
              return { ...c, images: existing ? c.images.map((i) => i.preview === img.preview ? img : i) : [...c.images, img] }
            }),
          }
        : s
    ))

  const removeCourtImage = (sportId: string, courtId: number, preview: string) =>
    setSports((prev) => prev.map((s) =>
      s.sportId === sportId
        ? { ...s, courts: s.courts.map((c) => c.id === courtId ? { ...c, images: c.images.filter((i) => i.preview !== preview) } : c) }
        : s
    ))

  const totalCourts = sports.reduce((acc, s) => acc + s.courts.length, 0)

  async function handleSave() {
    if (!venueId) return
    const uploading = sports.some((s) => s.courts.some((c) => c.images.some((img) => img.uploading)))
    if (uploading) { setError('Please wait for uploads to finish'); return }
    setError(''); setSaving(true)
    try {
      const allCourts = sports.flatMap((s) =>
        s.courts.map((c) => ({
          id: c.dbId,
          name: c.name, type: c.type, capacity: c.capacity, description: c.description,
          sportId: s.sportId, images: c.images.map((img) => img.url).filter(Boolean),
        }))
      )
      const res = await fetch(`/api/venues/${venueId}/courts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courts: allCourts }),
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
          <h1 className="text-xl font-semibold text-foreground">Courts</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {totalCourts} court{totalCourts !== 1 ? 's' : ''} across all sports
          </p>
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
                      {sport.courts.length === 0 ? 'No courts' : `${sport.courts.length} court${sport.courts.length !== 1 ? 's' : ''}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sport.expanded && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); addCourt(sport.sportId) }}
                      className="flex items-center gap-1 text-xs font-medium text-white px-3 py-1.5 rounded-lg hover:opacity-90 transition-all"
                      style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                      <Plus size={12} /> Add Court
                    </button>
                  )}
                  {sport.expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                </div>
              </div>

              {sport.expanded && (
                <div className="px-5 pb-5 border-t border-border space-y-4 pt-4">
                  {sport.courts.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
                      No courts yet. Click <span className="text-primary font-medium">"Add Court"</span> above.
                    </div>
                  )}
                  {sport.courts.map((court) => (
                    <div key={court.id} className="bg-muted/20 rounded-xl border border-border p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-green-500/10 flex items-center justify-center">
                            <Building2 size={13} className="text-green-600" />
                          </div>
                          <span className="text-sm font-medium">{court.name}</span>
                        </div>
                        <button onClick={() => removeCourt(sport.sportId, court.id)}
                          className="w-6 h-6 rounded-lg hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Court Name</label>
                          <input value={court.name} onChange={(e) => updateCourt(sport.sportId, court.id, 'name', e.target.value)}
                            className="w-full px-3 py-1.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Type</label>
                          <div className="flex gap-2">
                            {(['Indoor', 'Outdoor'] as const).map((t) => (
                              <button key={t} type="button" onClick={() => updateCourt(sport.sportId, court.id, 'type', t)}
                                className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all ${court.type === t ? 'border-primary text-primary bg-green-50' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Capacity</label>
                          <input type="number" value={court.capacity} onChange={(e) => updateCourt(sport.sportId, court.id, 'capacity', parseInt(e.target.value) || 1)}
                            className="w-full px-3 py-1.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                          <input value={court.description} onChange={(e) => updateCourt(sport.sportId, court.id, 'description', e.target.value)}
                            placeholder="e.g. Hardwood floor, AC"
                            className="w-full px-3 py-1.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                        </div>
                      </div>
                      <CourtImageRow courtId={court.id} images={court.images}
                        onAdd={(id, img) => addCourtImage(sport.sportId, id, img)}
                        onRemove={(id, preview) => removeCourtImage(sport.sportId, id, preview)} />
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
