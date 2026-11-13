import { NextResponse } from 'next/server'
import { courtLabelSelect, labelOf } from '@/lib/booking/courts'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn, zonedToUtc } from '@/lib/booking/time'
import { createClass } from '@/lib/club/service'
import { validateClass, type ClassInput } from '@/lib/club/validation'

// GET /api/classes?venueId&status=active|all — classes with schedule, enrolment counts and next session (bookings:view)
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venueId = ctx.access.venueId
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true, currency: true } })
    const today = todayIn(venue.timezone)
    const all = sp.get('status') === 'all'
    const classes = await prisma.class.findMany({
      where: { venueId, ...(!all && { status: 'ACTIVE', endDate: { gte: today } }) },
      include: {
        sport: { select: { name: true, emoji: true } },
        _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } },
        sessions: { where: { startTime: { gte: zonedToUtc(today, 0, venue.timezone) } }, select: { startTime: true }, orderBy: { startTime: 'asc' }, take: 1 },
      },
      orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
    })
    const courts = await prisma.court.findMany({ where: { venueId }, select: { id: true, ...courtLabelSelect } })
    const courtName = new Map(courts.map((c) => [c.id, labelOf(c)]))
    return NextResponse.json({
      today,
      currency: venue.currency,
      items: classes.map((c) => ({
        id: c.id, name: c.name, coachName: c.coachName, sportId: c.sportId, sportName: c.sport?.name ?? null, sportEmoji: c.sport?.emoji ?? null,
        courtIds: c.courtIds, courtNames: c.courtIds.map((id) => courtName.get(id) ?? 'Removed court'),
        days: c.days, startMin: c.startMin, endMin: c.endMin, startDate: c.startDate, endDate: c.endDate,
        capacity: c.capacity, enrolled: c._count.enrollments, fee: Number(c.fee), feePeriod: c.feePeriod, status: c.status,
        nextSession: c.sessions[0]?.startTime.toISOString() ?? null,
      })),
    })
  } catch (err) {
    return handleError(err, 'classes GET')
  }
}

// POST /api/classes — create a class and reserve its courts (venue:edit). 409 lists clashing sessions unless skipConflicts.
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const input = validateClass(body)
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'venue', 'edit')
    if (ctx instanceof Response) return ctx
    const r = await createClass(prisma, ctx.access.venueId, ctx.userId, input as ClassInput & { skipConflicts: boolean })
    return NextResponse.json(r, { status: 201 })
  } catch (err) {
    return handleError(err, 'classes POST')
  }
}
