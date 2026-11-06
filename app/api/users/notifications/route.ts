import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const prefs = await prisma.notificationPrefs.findUnique({
    where: { userId: session.user.id },
  })

  // Return defaults if no record yet
  return NextResponse.json(prefs ?? {
    newBooking: false, cancellation: false, payment: false, checkin: false,
    dailySummary: false, weeklySummary: false, lowOccupancy: false, smsAlerts: false,
  })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { newBooking, cancellation, payment, checkin, dailySummary, weeklySummary, lowOccupancy, smsAlerts } = body

    const prefs = await prisma.notificationPrefs.upsert({
      where:  { userId: session.user.id },
      update: { newBooking, cancellation, payment, checkin, dailySummary, weeklySummary, lowOccupancy, smsAlerts },
      create: { userId: session.user.id, newBooking, cancellation, payment, checkin, dailySummary, weeklySummary, lowOccupancy, smsAlerts },
    })

    return NextResponse.json(prefs)
  } catch (err) {
    console.error('[notifications PATCH]', err)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
