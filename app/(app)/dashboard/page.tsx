'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DashboardScreen } from '@/components/dashboard/dashboard-screen'
import { usePermissions } from '@/hooks/use-permissions'

export default function DashboardPage() {
  const router = useRouter()
  const { canView, loading } = usePermissions()
  const allowed = canView('reports')

  // Employees land here after login; send them to the calendar instead.
  useEffect(() => {
    if (!loading && !allowed) router.replace('/calendar')
  }, [loading, allowed, router])

  if (loading || !allowed) return null
  return <DashboardScreen />
}
