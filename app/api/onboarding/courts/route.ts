import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

type CourtPayload = {
  name: string
  type: string
  capacity: number
  description: string
  sportId: string
  images: string[]
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { courts } = await req.json() as { courts: CourtPayload[] }

    const venue = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
    })
    if (!venue) return NextResponse.json({ error: 'No venue in progress' }, { status: 404 })

    await prisma.court.deleteMany({ where: { venueId: venue.id } })

    if (courts?.length) {
      await prisma.court.createMany({
        data: courts.map((c) => ({
          venueId: venue.id,
          sportId: c.sportId || null,
          name: c.name,
          type: c.type === 'Outdoor' ? 'OUTDOOR' : 'INDOOR',
          capacity: c.capacity,
          description: c.description || null,
          images: c.images ?? [],
        })),
      })
    }

    await prisma.venue.update({
      where: { id: venue.id },
      data: { onboardingStep: 'PRICING' },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/courts]', err)
    return NextResponse.json({ error: 'Failed to save courts' }, { status: 500 })
  }
}
