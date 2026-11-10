'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PaymentsScreen } from '@/components/payments/payments-screen'
import { usePermissions } from '@/hooks/use-permissions'

export default function PaymentsPage() {
  const router = useRouter()
  const { canView, loading } = usePermissions()
  const allowed = canView('billing')
  useEffect(() => { if (!loading && !allowed) router.replace('/calendar') }, [loading, allowed, router])
  if (loading || !allowed) return null
  return <PaymentsScreen />
}
