'use client'

import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import { Globe, Phone, Mail, FileText, Upload, X, ImageIcon, Save, Check, Plus } from 'lucide-react'

type Form = {
  name: string; description: string; phone: string; email: string
  website: string; address: string; city: string; state: string; zip: string; country: string
}
type UploadedImage = { preview: string; url: string | null; uploading: boolean }

const ENUM_TO_TYPE: Record<string, string> = {
  PRIVATE: 'Private', PUBLIC: 'Public', SEMI_PUBLIC: 'Semi-Public',
}

const AMENITY_SUGGESTIONS = [
  'Parking', 'WiFi', 'Changing Rooms', 'Lockers', 'Showers',
  'Air Conditioning', 'Equipment Rental', 'Cafeteria', 'Spectator Seating', 'Pro Shop',
]

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Upload failed')
  return (await res.json()).url as string
}

function ImageUploadBox({ label, hint, value, onChange, aspect = 'square' }: {
  label: string; hint: string; value: UploadedImage | null
  onChange: (img: UploadedImage | null) => void; aspect?: 'square' | 'wide'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const handleFile = async (file: File) => {
    const preview = URL.createObjectURL(file)
    onChange({ preview, url: null, uploading: true })
    try { onChange({ preview, url: await uploadFile(file), uploading: false }) }
    catch { onChange({ preview, url: null, uploading: false }) }
  }
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {value ? (
        <div className={`relative rounded-xl overflow-hidden border border-border bg-muted ${aspect === 'wide' ? 'h-32' : 'h-24 w-24'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.preview} alt="" className="w-full h-full object-cover" />
          {value.uploading
            ? <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>
            : <button type="button" onClick={() => onChange(null)} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={12} /></button>}
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary/40 transition-colors cursor-pointer bg-muted/20 h-24 w-24">
          <Upload size={18} className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center px-2">{hint}</p>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}
    </div>
  )
}

function CoverUploadBox({ value, onChange }: { value: UploadedImage | null; onChange: (img: UploadedImage | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const handleFile = async (file: File) => {
    const preview = URL.createObjectURL(file)
    onChange({ preview, url: null, uploading: true })
    try { onChange({ preview, url: await uploadFile(file), uploading: false }) }
    catch { onChange({ preview, url: null, uploading: false }) }
  }
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">Cover Photo</label>
      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-border bg-muted h-32">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.preview} alt="" className="w-full h-full object-cover" />
          {value.uploading
            ? <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>
            : <button type="button" onClick={() => onChange(null)} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={12} /></button>}
        </div>
      ) : (
        <div onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary/40 transition-colors cursor-pointer bg-muted/20 h-32">
          <Upload size={18} className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center px-2">Recommended 1200×400</p>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
        </div>
      )}
    </div>
  )
}

export default function FacilitySettingsPage() {
  const [venueId, setVenueId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>({ name: '', description: '', phone: '', email: '', website: '', address: '', city: '', state: '', zip: '', country: '' })
  const [facilityType, setFacilityType] = useState('Private')
  const [amenities, setAmenities] = useState<string[]>([])
  const [amenityInput, setAmenityInput] = useState('')
  const [logo, setLogo] = useState<UploadedImage | null>(null)
  const [cover, setCover] = useState<UploadedImage | null>(null)
  const [gallery, setGallery] = useState<UploadedImage[]>([])
  const galleryInputRef = useRef<HTMLInputElement>(null)
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
        setForm({ name: venue.name ?? '', description: venue.description ?? '', phone: venue.phone ?? '', email: venue.email ?? '', website: venue.website ?? '', address: venue.address ?? '', city: venue.city ?? '', state: venue.state ?? '', zip: venue.zip ?? '', country: venue.country ?? '' })
        setFacilityType(ENUM_TO_TYPE[venue.type] ?? 'Private')
        setAmenities((venue.amenities ?? []).map((a: { name: string }) => a.name))
        const imgs = venue.images ?? []
        const logoImg = imgs.find((i: { isLogo: boolean }) => i.isLogo)
        const coverImg = imgs.find((i: { isCover: boolean }) => i.isCover)
        const galleryImgs = imgs.filter((i: { isLogo: boolean; isCover: boolean }) => !i.isLogo && !i.isCover)
        if (logoImg) setLogo({ preview: logoImg.imageUrl, url: logoImg.imageUrl, uploading: false })
        if (coverImg) setCover({ preview: coverImg.imageUrl, url: coverImg.imageUrl, uploading: false })
        setGallery(galleryImgs.map((i: { imageUrl: string }) => ({ preview: i.imageUrl, url: i.imageUrl, uploading: false })))
      })
      .catch(() => setError('Failed to load venue'))
      .finally(() => setLoading(false))
  }, [])

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const addAmenity = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || amenities.includes(trimmed)) return
    setAmenities((prev) => [...prev, trimmed])
    setAmenityInput('')
  }

  const onAmenityKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAmenity(amenityInput) }
  }

  const addGalleryFile = async (file: File) => {
    const preview = URL.createObjectURL(file)
    setGallery((prev) => [...prev, { preview, url: null, uploading: true }])
    try {
      const url = await uploadFile(file)
      setGallery((prev) => prev.map((img) => img.preview === preview ? { preview, url, uploading: false } : img))
    } catch {
      setGallery((prev) => prev.map((img) => img.preview === preview ? { preview, url: null, uploading: false } : img))
    }
  }

  async function handleSave() {
    if (!venueId) return
    if ([logo, cover, ...gallery].some((img) => img?.uploading)) { setError('Please wait for uploads to finish'); return }
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/api/venues/${venueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, type: facilityType, amenities, logoUrl: logo?.url ?? null, coverUrl: cover?.url ?? null, galleryUrls: gallery.map((img) => img.url).filter(Boolean) }),
      })
      if (!res.ok) { setError((await res.json()).error ?? 'Save failed'); return }
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch { setError('Something went wrong.') }
    finally { setSaving(false) }
  }

  const inp = 'w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  if (loading) return <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Facility Info</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Basic details, contact, location and photos</p>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving…' : <><Save size={14} /> Save</>}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="space-y-6">
        {/* Basic */}
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Basic</p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Facility Name *</label>
              <input value={form.name} onChange={set('name')} placeholder="e.g. Downtown Sports Center" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Description</label>
              <textarea value={form.description} onChange={set('description')} rows={3}
                placeholder="e.g. Modern indoor facility with 4 badminton courts, pro-grade flooring and full lighting"
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />

              <div className="mt-3">
                <p className="text-sm font-medium mb-2">Amenities</p>
                {amenities.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {amenities.map((a) => (
                      <span key={a} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-xs font-medium text-green-700">
                        {a}
                        <button type="button" onClick={() => setAmenities((prev) => prev.filter((x) => x !== a))}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input value={amenityInput} onChange={(e) => setAmenityInput(e.target.value)} onKeyDown={onAmenityKey}
                    placeholder="Type and press Enter…"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
                  <button type="button" onClick={() => addAmenity(amenityInput)}
                    className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
                    <Plus size={14} />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {AMENITY_SUGGESTIONS.filter((s) => !amenities.includes(s)).slice(0, 6).map((s) => (
                    <button key={s} type="button" onClick={() => addAmenity(s)}
                      className="text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors">
                      + {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5"><FileText size={13} className="inline mr-1" />Facility Type</label>
              <div className="flex gap-2">
                {['Private', 'Public', 'Semi-Public'].map((t) => (
                  <button key={t} type="button" onClick={() => setFacilityType(t)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${facilityType === t ? 'border-primary text-primary bg-green-50' : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Contact</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5"><Phone size={13} className="inline mr-1" />Phone</label>
              <input value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5"><Mail size={13} className="inline mr-1" />Email</label>
              <input value={form.email} onChange={set('email')} type="email" placeholder="info@yourvenue.com" className={inp} />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5"><Globe size={13} className="inline mr-1" />Website</label>
              <input value={form.website} onChange={set('website')} placeholder="www.yourvenue.com" className={inp} />
            </div>
          </div>
        </div>

        {/* Location */}
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Location</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1.5">Street Address</label>
              <input value={form.address} onChange={set('address')} placeholder="123 Main Street" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">City</label>
              <input value={form.city} onChange={set('city')} placeholder="New York" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">State</label>
              <input value={form.state} onChange={set('state')} placeholder="NY" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">ZIP</label>
              <input value={form.zip} onChange={set('zip')} placeholder="10001" className={inp} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Country</label>
              <input value={form.country} onChange={set('country')} placeholder="United States" className={inp} />
            </div>
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-xl border border-border p-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Photos & Branding</p>
          <div className="grid grid-cols-2 gap-5 mb-4">
            <ImageUploadBox label="Logo" hint="PNG, JPG up to 5MB" value={logo} onChange={setLogo} />
            <CoverUploadBox value={cover} onChange={setCover} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Gallery</label>
            <div className="flex flex-wrap gap-3">
              {gallery.map((img) => (
                <div key={img.preview} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  {img.uploading
                    ? <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /></div>
                    : <button type="button" onClick={() => setGallery((prev) => prev.filter((i) => i.preview !== img.preview))} className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={10} /></button>}
                </div>
              ))}
              <button type="button" onClick={() => galleryInputRef.current?.click()}
                className="w-20 h-20 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-1 hover:border-primary/40 transition-colors cursor-pointer bg-muted/20">
                <ImageIcon size={15} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Add</span>
              </button>
              <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={(e) => { Array.from(e.target.files ?? []).forEach(addGalleryFile); e.target.value = '' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
