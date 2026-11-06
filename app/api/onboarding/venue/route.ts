import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const venue = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
      include: {
        sports: {
          include: { operatingHours: true, pricingRules: true },
        },
        courts: true,
        images: true,
        pricingRules: true,
      },
    })

    if (!venue) return NextResponse.json({ error: 'No venue in progress' }, { status: 404 })

    return NextResponse.json(venue)
  } catch (err) {
    console.error('[onboarding/venue GET]', err)
    return NextResponse.json({ error: 'Failed to fetch venue' }, { status: 500 })
  }
}
