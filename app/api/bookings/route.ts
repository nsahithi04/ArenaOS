import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function assertVenueAccess(userId: string, venueId: string) {
  const owned = await prisma.venue.findFirst({ where: { id: venueId, ownerId: userId } })
  if (owned) return true
  const member = await prisma.venueMember.findFirst({ where: { venueId, userId, status: 'active' } })
  return !!member
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const venueId = searchParams.get('venueId')
  if (!venueId) return NextResponse.json({ error: 'venueId required' }, { status: 400 })

  if (!(await assertVenueAccess(session.user.id, venueId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const date = searchParams.get('date')

  const bookings = await prisma.booking.findMany({
    where: {
      venueId,
      ...(date && {
        startTime: { gte: new Date(date) },
        endTime: { lt: new Date(new Date(date).setDate(new Date(date).getDate() + 1)) },
      }),
    },
    include: { court: true },
    orderBy: { startTime: 'asc' },
  })

  return NextResponse.json(bookings)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { venueId, courtId, customer, phone, sport, startTime, endTime, amountUsd, notes } = await req.json()

    if (!venueId || !courtId || !customer || !startTime || !endTime || amountUsd == null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!(await assertVenueAccess(session.user.id, venueId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const booking = await prisma.booking.create({
      data: {
        venueId,
        courtId,
        customer,
        phone: phone ?? null,
        sport: sport ?? null,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        amountUsd,
        notes: notes ?? null,
      },
    })
    return NextResponse.json(booking, { status: 201 })
  } catch (err) {
    console.error('[bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
