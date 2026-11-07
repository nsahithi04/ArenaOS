import { Suspense } from 'react'
import { BookingsScreen } from '@/components/bookings/bookings-screen'

export default function BookingsPage() {
  // Suspense is required because the screen reads ?q= from the URL (top-bar search).
  return (
    <Suspense fallback={null}>
      <BookingsScreen />
    </Suspense>
  )
}
