'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Building2, Dumbbell, Clock, DollarSign, ChevronLeft, Rocket } from 'lucide-react'

const SECTIONS = [
  { icon: Building2,  label: 'Facility Info',      href: '/onboarding/facility' },
  { icon: Dumbbell,   label: 'Sports',              href: '/onboarding/sports'   },
  { icon: Clock,      label: 'Operating Hours',     href: '/onboarding/hours'    },
  { icon: Building2,  label: 'Courts',              href: '/onboarding/courts'   },
  { icon: DollarSign, label: 'Pricing',             href: '/onboarding/pricing'  },
]

export default function ReviewPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleLaunch() {
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/onboarding/complete', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to launch')
        return
      }
      router.push('/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-foreground">Review & Launch</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Everything looks good? Go live or go back to edit any section.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {SECTIONS.map(({ icon: Icon, label, href }) => (
          <div
            key={href}
            className="flex items-center gap-4 p-4 bg-white rounded-xl border border-border"
          >
            <div className="w-9 h-9 rounded-lg bg-green-500/10 flex items-center justify-center flex-shrink-0">
              <Icon size={16} className="text-green-600" />
            </div>
            <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                <Check size={11} className="text-white" />
              </div>
              <button
                onClick={() => router.push(href)}
                className="text-xs text-primary underline underline-offset-2 hover:no-underline"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      <div
        className="rounded-xl p-5 mb-8"
        style={{ background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)' }}
      >
        <p className="text-sm font-medium text-green-800 mb-1">Ready to go live?</p>
        <p className="text-sm text-green-700">
          After launching, you can manage your venue from the dashboard. You can always edit
          settings, add courts, or update pricing at any time.
        </p>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      <div className="flex items-center justify-between pt-6 border-t border-border">
        <button
          onClick={() => router.push('/onboarding/pricing')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-white transition-all"
        >
          <ChevronLeft size={16} /> Back
        </button>
        <button
          onClick={handleLaunch}
          disabled={loading}
          className="flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold text-white hover:opacity-90 transition-all disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg, #16a34a, #2563eb)' }}
        >
          <Rocket size={16} /> {loading ? 'Launching…' : 'Launch My Venue'}
        </button>
      </div>
    </div>
  )
}
