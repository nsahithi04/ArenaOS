'use client'

import { usePathname } from 'next/navigation'
import { Logo } from '@/components/brand/logo'
import { Building2, Dumbbell, Clock, DollarSign, Check, ClipboardList } from 'lucide-react'

const steps = [
  { slug: 'facility', label: 'Facility Info',     icon: Building2    },
  { slug: 'sports',   label: 'Sports',             icon: Dumbbell     },
  { slug: 'hours',    label: 'Operating Hours',    icon: Clock        },
  { slug: 'courts',   label: 'Court Setup',        icon: Building2    },
  { slug: 'pricing',  label: 'Pricing',            icon: DollarSign   },
  { slug: 'review',   label: 'Review & Launch',    icon: ClipboardList },
]

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const currentSlug = pathname.split('/').pop() ?? 'facility'
  const currentIndex = steps.findIndex((s) => s.slug === currentSlug)
  const progress = Math.round(((currentIndex + 1) / steps.length) * 100)

  return (
    <div className="min-h-screen bg-muted flex">
      {/* Wizard sidebar */}
      <div
        className="w-72 flex-shrink-0 hidden lg:flex flex-col"
        style={{ background: '#0f172a', borderRight: '1px solid #1e293b' }}
      >
        <div className="px-6 py-6 border-b border-white/10">
          <Logo dark size="md" />
          <p className="text-slate-400 text-xs mt-2">Venue Setup Wizard</p>
        </div>

        <div className="flex-1 py-6 px-4 space-y-1">
          {steps.map((s, i) => {
            const Icon = s.icon
            const done   = i < currentIndex
            const active = i === currentIndex
            return (
              <div
                key={s.slug}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-all ${active ? 'bg-white/10' : ''}`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium ${
                    done
                      ? 'bg-green-500 text-white'
                      : active
                      ? 'bg-green-500/20 text-green-400 border border-green-500/40'
                      : 'bg-white/5 text-slate-500'
                  }`}
                >
                  {done ? <Check size={14} /> : i + 1}
                </div>
                <div>
                  <p className={`text-sm font-medium ${active ? 'text-white' : done ? 'text-green-400' : 'text-slate-500'}`}>
                    {s.label}
                  </p>
                  <p className="text-xs text-slate-600">Step {i + 1} of {steps.length}</p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 pb-6">
          <div
            className="rounded-lg p-4"
            style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)' }}
          >
            <p className="text-green-400 text-xs font-medium mb-1">Setup Progress</p>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-slate-400 text-xs mt-1">{progress}% complete</p>
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {/* Mobile step dots */}
        <div className="flex lg:hidden gap-1 px-6 pt-6">
          {steps.map((s, i) => (
            <div
              key={s.slug}
              className={`flex-1 h-1.5 rounded-full transition-all ${
                i <= currentIndex ? 'bg-primary' : 'bg-border'
              }`}
            />
          ))}
        </div>

        <div className="max-w-3xl mx-auto px-6 py-10">{children}</div>
      </div>
    </div>
  )
}
