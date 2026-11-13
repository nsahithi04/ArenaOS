import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { courtNameProblems } from '@/lib/booking/courts'

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
    if (!Array.isArray(courts)) return NextResponse.json({ error: 'courts must be an array' }, { status: 400 })
    const sports = await prisma.sport.findMany({ where: { venueId: venue.id }, select: { id: true, name: true } })
    const problems = courtNameProblems(courts, (sid) => sports.find((s) => s.id === sid)?.name ?? '')
    if (problems.length) return NextResponse.json({ error: problems[0].message, code: 'COURT_NAME', problems }, { status: 422 })

    await prisma.court.deleteMany({ where: { venueId: venue.id } })

    if (courts?.length) {
      await prisma.court.createMany({
        data: courts.map((c) => ({
          venueId: venue.id,
          sportId: c.sportId || null,
          name: c.name.trim().replace(/\s+/g, ' '),
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
