import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const venue = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
    })
    if (!venue) return NextResponse.json({ error: 'No venue in progress' }, { status: 404 })

    await prisma.venue.update({
      where: { id: venue.id },
      data: { isSetupDone: true, onboardingStep: 'DONE' },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/complete]', err)
    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 })
  }
}
