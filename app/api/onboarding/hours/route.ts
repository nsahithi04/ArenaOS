import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { DayOfWeek } from '@prisma/client'

const DAY_MAP: Record<string, DayOfWeek> = {
  Monday: 'MONDAY',
  Tuesday: 'TUESDAY',
  Wednesday: 'WEDNESDAY',
  Thursday: 'THURSDAY',
  Friday: 'FRIDAY',
  Saturday: 'SATURDAY',
  Sunday: 'SUNDAY',
}

type DayRow = { day: string; open: string; close: string; isClosed: boolean }
type SportHoursPayload = { sportId: string; hours: DayRow[] }

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sports } = await req.json() as { sports: SportHoursPayload[] }

    const venue = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
    })
    if (!venue) return NextResponse.json({ error: 'No venue in progress' }, { status: 404 })

    // Delete all existing hours for this venue and recreate
    await prisma.operatingHours.deleteMany({ where: { venueId: venue.id } })

    const rows = sports.flatMap(({ sportId, hours }) =>
      hours.map((h) => ({
        venueId: venue.id,
        sportId,
        day: DAY_MAP[h.day],
        openTime: h.open,
        closeTime: h.close,
        isClosed: h.isClosed,
      })),
    )

    if (rows.length) {
      await prisma.operatingHours.createMany({ data: rows })
    }

    await prisma.venue.update({
      where: { id: venue.id },
      data: { onboardingStep: 'COURTS' },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/hours]', err)
    return NextResponse.json({ error: 'Failed to save hours' }, { status: 500 })
  }
}
