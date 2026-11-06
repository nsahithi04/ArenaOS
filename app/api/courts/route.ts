import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function assertVenueAccess(userId: string, venueId: string) {
  // Owner check
  const owned = await prisma.venue.findFirst({ where: { id: venueId, ownerId: userId } })
  if (owned) return true
  // Active member check
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

  const courts = await prisma.court.findMany({
    where: { venueId, isActive: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(courts)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { venueId, sportId, name, type, capacity, description, images } = await req.json()
    if (!venueId || !name) return NextResponse.json({ error: 'venueId and name are required' }, { status: 400 })

    if (!(await assertVenueAccess(session.user.id, venueId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const court = await prisma.court.create({
      data: {
        venueId,
        sportId: sportId ?? null,
        name,
        type: type === 'OUTDOOR' ? 'OUTDOOR' : 'INDOOR',
        capacity: capacity ?? 4,
        description: description ?? null,
        images: images ?? [],
      },
    })
    return NextResponse.json(court, { status: 201 })
  } catch (err) {
    console.error('[courts POST]', err)
    return NextResponse.json({ error: 'Failed to create court' }, { status: 500 })
  }
}
