'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import { Building2, Dumbbell, LayoutGrid, DollarSign, Clock } from 'lucide-react'

const sections = [
  { href: '/venue/facility', label: 'Facility Info',  icon: Building2 },
  { href: '/venue/sports',   label: 'Sports',          icon: Dumbbell },
  { href: '/venue/courts',   label: 'Courts',          icon: LayoutGrid },
  { href: '/venue/timings',  label: 'Timings',         icon: Clock },
  { href: '/venue/pricing',  label: 'Pricing',         icon: DollarSign },
]

export default function VenueLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { canView, loading } = usePermissions()
  const allowed = canView('venue')

  useEffect(() => {
    if (!loading && !allowed) router.replace('/calendar')
  }, [loading, allowed, router])

  if (loading || !allowed) return null

  return (
    <div className="flex h-full">
      {/* Secondary sidebar */}
      <aside className="w-52 flex-shrink-0 bg-white border-r border-border flex flex-col">
        <div className="px-4 pt-6 pb-4 border-b border-border">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Venue Settings</p>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {sections.map((s) => {
            const Icon = s.icon
            const active = pathname === s.href || pathname.startsWith(s.href + '/')
            return (
              <button
                key={s.href}
                onClick={() => router.push(s.href)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-green-50 text-green-700'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                <Icon size={16} className={active ? 'text-green-600' : ''} />
                {s.label}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
