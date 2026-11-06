'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Globe, Phone, Mail, FileText, ChevronRight, Upload, X, ImageIcon } from 'lucide-react'

type Form = {
  name: string
  description: string
  phone: string
  email: string
  website: string
  address: string
  city: string
  state: string
  zip: string
  country: string
}

type UploadedImage = { preview: string; url: string | null; uploading: boolean }

async function uploadFile(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Upload failed')
  const data = await res.json()
  return data.url as string
}

function ImageUploadBox({
  label,
  hint,
  value,
  onChange,
  aspect = 'square',
}: {
  label: string
  hint: string
  value: UploadedImage | null
  onChange: (img: UploadedImage | null) => void
  aspect?: 'square' | 'wide'
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    const preview = URL.createObjectURL(file)
    onChange({ preview, url: null, uploading: true })
    try {
      const url = await uploadFile(file)
      onChange({ preview, url, uploading: false })
    } catch {
      onChange({ preview, url: null, uploading: false })
    }
  }

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      {value ? (
        <div className={`relative rounded-xl overflow-hidden border border-border bg-muted ${aspect === 'wide' ? 'h-32' : 'h-24 w-24'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.preview} alt="" className="w-full h-full object-cover" />
          {value.uploading && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!value.uploading && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          className={`border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-2 hover:border-primary/40 transition-colors cursor-pointer bg-muted/20 ${aspect === 'wide' ? 'h-32' : 'h-24 w-24'}`}
        >
          <Upload size={18} className="text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center px-2">{hint}</p>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onInput} />
        </div>
      )}
    </div>
  )
}

const ENUM_TO_TYPE: Record<string, string> = {
  PRIVATE: 'Private', PUBLIC: 'Public', SEMI_PUBLIC: 'Semi-Public',
}

export default function FacilityPage() {
  const router = useRouter()
  const [facilityType, setFacilityType] = useState('Private')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<Form>({
    name: '', description: '', phone: '', email: '',
    website: '', address: '', city: '', state: '', zip: '', country: '',
  })

  const [logo, setLogo] = useState<UploadedImage | null>(null)
  const [cover, setCover] = useState<UploadedImage | null>(null)
  const [gallery, setGallery] = useState<UploadedImage[]>([])
  const galleryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/onboarding/venue')
      .then((r) => r.json())
      .then((venue) => {
        if (venue.error) return
        setForm({
          name: venue.name ?? '',
          description: venue.description ?? '',
          phone: venue.phone ?? '',
          email: venue.email ?? '',
          website: venue.website ?? '',
          address: venue.address ?? '',
          city: venue.city ?? '',
          state: venue.state ?? '',
          zip: venue.zip ?? '',
          country: venue.country ?? '',
        })
        setFacilityType(ENUM_TO_TYPE[venue.type] ?? 'Private')
        const imgs: { imageUrl: string; isLogo: boolean; isCover: boolean }[] = venue.images ?? []
        const logoImg = imgs.find((i) => i.isLogo)
        const coverImg = imgs.find((i) => i.isCover)
        const galleryImgs = imgs.filter((i) => !i.isLogo && !i.isCover)
        if (logoImg) setLogo({ preview: logoImg.imageUrl, url: logoImg.imageUrl, uploading: false })
        if (coverImg) setCover({ preview: coverImg.imageUrl, url: coverImg.imageUrl, uploading: false })
        setGallery(galleryImgs.map((i) => ({ preview: i.imageUrl, url: i.imageUrl, uploading: false })))
      })
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [])

  if (fetching) return <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">Loading…</div>

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [k]: e.target.value }))

  const addGalleryFile = async (file: File) => {
    const preview = URL.createObjectURL(file)
    const placeholder: UploadedImage = { preview, url: null, uploading: true }
    setGallery((prev) => [...prev, placeholder])
    try {
      const url = await uploadFile(file)
      setGallery((prev) => prev.map((img) => img.preview === preview ? { preview, url, uploading: false } : img))
    } catch {
      setGallery((prev) => prev.map((img) => img.preview === preview ? { preview, url: null, uploading: false } : img))
    }
  }

  const onGalleryInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    files.forEach(addGalleryFile)
    e.target.value = ''
  }

  const removeGallery = (preview: string) =>
    setGallery((prev) => prev.filter((img) => img.preview !== preview))

  async function handleContinue() {
    if (!form.name.trim()) { setError('Facility name is required'); return }
    const uploading = [logo, cover, ...gallery].some((img) => img?.uploading)
    if (uploading) { setError('Please wait for uploads to finish'); return }

    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/onboarding/facility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          type: facilityType,
          logoUrl: logo?.url ?? null,
          coverUrl: cover?.url ?? null,
          galleryUrls: gallery.map((img) => img.url).filter(Boolean),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        return
      }
      router.push('/onboarding/sports')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const input = 'w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Facility Information</h2>
        <p className="text-muted-foreground mt-1 text-sm">Tell us about your sports facility</p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1.5">Facility Name *</label>
          <input value={form.name} onChange={set('name')} placeholder="e.g. Downtown Sports Center" className={input} />
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1.5">Description</label>
          <textarea value={form.description} onChange={set('description')} rows={3}
            placeholder="Describe your facility..."
            className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5"><Phone size={13} className="inline mr-1" />Contact Number</label>
          <input value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5"><Mail size={13} className="inline mr-1" />Email</label>
          <input value={form.email} onChange={set('email')} type="email" placeholder="info@yourvenue.com" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5"><Globe size={13} className="inline mr-1" />Website</label>
          <input value={form.website} onChange={set('website')} placeholder="www.yourvenue.com" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5"><FileText size={13} className="inline mr-1" />Facility Type</label>
          <div className="flex gap-2">
            {['Private', 'Public', 'Semi-Public'].map((t) => (
              <button key={t} type="button" onClick={() => setFacilityType(t)}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                  facilityType === t ? 'border-primary text-primary bg-green-50' : 'border-border text-muted-foreground hover:border-primary/40'
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1.5">Address</label>
          <input value={form.address} onChange={set('address')} placeholder="123 Main Street" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">City</label>
          <input value={form.city} onChange={set('city')} placeholder="New York" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">State</label>
          <input value={form.state} onChange={set('state')} placeholder="NY" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">ZIP Code</label>
          <input value={form.zip} onChange={set('zip')} placeholder="10001" className={input} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Country</label>
          <input value={form.country} onChange={set('country')} placeholder="United States" className={input} />
        </div>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Address will be automatically converted to coordinates for map display.
      </p>

      {/* Images section */}
      <div className="mt-6 pt-6 border-t border-border">
        <h3 className="text-sm font-semibold text-foreground mb-4">Photos & Branding</h3>
        <div className="grid grid-cols-2 gap-5">
          <ImageUploadBox
            label="Logo"
            hint="PNG, JPG up to 5MB"
            value={logo}
            onChange={setLogo}
            aspect="square"
          />
          <ImageUploadBox
            label="Cover Photo"
            hint="Recommended 1200×400"
            value={cover}
            onChange={setCover}
            aspect="wide"
          />
        </div>

        {/* Gallery */}
        <div className="mt-4">
          <label className="block text-sm font-medium mb-2">Gallery Photos</label>
          <div className="flex flex-wrap gap-3">
            {gallery.map((img) => (
              <div key={img.preview} className="relative w-24 h-24 rounded-xl overflow-hidden border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
                {img.uploading ? (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <button type="button" onClick={() => removeGallery(img.preview)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center">
                    <X size={10} />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="w-24 h-24 border-2 border-dashed border-border rounded-xl flex flex-col items-center justify-center gap-1.5 hover:border-primary/40 transition-colors cursor-pointer bg-muted/20"
            >
              <ImageIcon size={16} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Add photo</span>
            </button>
            <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={onGalleryInput} />
          </div>
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}

      <div className="flex justify-end mt-8 pt-6 border-t border-border">
        <button onClick={handleContinue} disabled={loading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
          {loading ? 'Saving…' : 'Continue'} <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
