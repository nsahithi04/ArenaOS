import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sports } = await req.json()

    const venue = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
    })
    if (!venue) return NextResponse.json({ error: 'No venue in progress' }, { status: 404 })

    await prisma.sport.deleteMany({ where: { venueId: venue.id } })

    if (sports?.length) {
      await prisma.sport.createMany({
        data: sports.map((s: { name: string; emoji?: string }) => ({
          venueId: venue.id,
          name: s.name,
          emoji: s.emoji ?? null,
        })),
      })
    }

    await prisma.venue.update({
      where: { id: venue.id },
      data: { onboardingStep: 'HOURS' },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/sports]', err)
    return NextResponse.json({ error: 'Failed to save sports' }, { status: 500 })
  }
}
