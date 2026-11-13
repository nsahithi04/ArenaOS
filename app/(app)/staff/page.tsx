'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { StaffScreen } from '@/components/staff/staff-screen'
import { usePermissions } from '@/hooks/use-permissions'

export default function StaffPage() {
  const router = useRouter()
  const { canView, loading } = usePermissions()
  const allowed = canView('team')
  useEffect(() => { if (!loading && !allowed) router.replace('/my-shifts') }, [loading, allowed, router])
  if (loading || !allowed) return null
  return <StaffScreen />
}
