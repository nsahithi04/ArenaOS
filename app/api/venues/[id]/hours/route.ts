import { NextResponse } from 'next/server'
import { requireVenue } from '@/lib/booking/route-helpers'
import { prisma } from '@/lib/db'
import { DayOfWeek } from '@prisma/client'

const DAY_MAP: Record<string, DayOfWeek> = {
  Monday: 'MONDAY', Tuesday: 'TUESDAY', Wednesday: 'WEDNESDAY',
  Thursday: 'THURSDAY', Friday: 'FRIDAY', Saturday: 'SATURDAY', Sunday: 'SUNDAY',
}

type DayRow = { day: string; open: string; close: string; isClosed: boolean }
type SportHoursPayload = { sportId: string; hours: DayRow[] }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx

  try {

    const { sports } = await req.json() as { sports: SportHoursPayload[] }

    await prisma.operatingHours.deleteMany({ where: { venueId: id } })

    const rows = sports.flatMap(({ sportId, hours }) =>
      hours.map((h) => ({
        venueId: id, sportId,
        day: DAY_MAP[h.day],
        openTime: h.open, closeTime: h.close, isClosed: h.isClosed,
      }))
    )
    if (rows.length) await prisma.operatingHours.createMany({ data: rows })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[venues/hours POST]', err)
    return NextResponse.json({ error: 'Failed to save hours' }, { status: 500 })
  }
}
