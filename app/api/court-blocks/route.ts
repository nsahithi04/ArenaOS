import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { createCourtBlock } from '@/lib/booking/service'
import { isLocalDate, localDateOf, localMinutesOf, localRangeToUtc } from '@/lib/booking/time'
import { validateBlock } from '@/lib/booking/validation'

// GET /api/court-blocks?venueId&from&to — maintenance / unavailable periods overlapping the range.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const from = sp.get('from')
    const to = sp.get('to')
    if (!isLocalDate(from) || !isLocalDate(to)) return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 })
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.access.venueId }, select: { timezone: true } })
    const { start, end } = localRangeToUtc(from, to, venue.timezone)
    const blocks = await prisma.courtBlock.findMany({
      where: { venueId: ctx.access.venueId, startTime: { lt: end }, endTime: { gt: start } },
      orderBy: { startTime: 'asc' },
      take: 5000,
      include: { class: { select: { name: true, coachName: true } } },
    })
    return NextResponse.json(
      blocks.map((b) => ({
        id: b.id,
        courtId: b.courtId,
        reason: b.reason,
        classId: b.classId,
        className: b.class?.name ?? null,
        coachName: b.class?.coachName ?? null,
        start: b.startTime.toISOString(),
        end: b.endTime.toISOString(),
        date: localDateOf(b.startTime, venue.timezone),
        startMin: localMinutesOf(b.startTime, venue.timezone),
        endMin: localDateOf(b.endTime, venue.timezone) !== localDateOf(b.startTime, venue.timezone) ? 1440 : localMinutesOf(b.endTime, venue.timezone),
      })),
    )
  } catch (err) {
    return handleError(err, 'court-blocks GET')
  }
}

// POST /api/court-blocks — block a court (maintenance). Fails with 409 if bookings already occupy the slot.
export async function POST(req: Request) {
  try {
    const input = validateBlock(await readJson(req))
    const ctx = await requireVenue(input.venueId, 'bookings', 'edit')
    if (ctx instanceof Response) return ctx
    const block = await createCourtBlock(prisma, ctx.access.venueId, ctx.userId, input)
    return NextResponse.json({ id: block.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'court-blocks POST')
  }
}
