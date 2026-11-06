import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

const venueInclude = {
  images: true,
  amenities: true,
  sports: true,
  courts: true,
  operatingHours: true,
  pricingRules: true,
} as const

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Owners: return all venues they own
  const ownedVenues = await prisma.venue.findMany({
    where: { ownerId: session.user.id },
    include: venueInclude,
  })
  if (ownedVenues.length > 0) return NextResponse.json(ownedVenues)

  // Staff/members: return the venue they are an active member of
  const membership = await prisma.venueMember.findFirst({
    where: { userId: session.user.id, status: 'active' },
    include: { venue: { include: venueInclude } },
  })
  if (membership?.venue) return NextResponse.json([membership.venue])

  return NextResponse.json([])
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const venue = await prisma.venue.create({
      data: { ...body, ownerId: session.user.id },
    })
    return NextResponse.json(venue, { status: 201 })
  } catch (err) {
    console.error('[venues POST]', err)
    return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 })
  }
}
