import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { todayIn, zonedToUtc } from '@/lib/booking/time'
import { cancelClass, netPaid, updateClass } from '@/lib/club/service'
import { validateClass } from '@/lib/club/validation'

type Params = { params: Promise<{ id: string }> }

async function lookup(id: string, module: 'bookings' | 'venue', level: 'view' | 'edit') {
  if (!isId(id)) return jsonError(404, 'Class not found')
  const c = await prisma.class.findUnique({ where: { id }, select: { venueId: true } })
  return requireEntityVenue(c?.venueId, module, level, 'Class not found')
}

// GET /api/classes/:id — class with students, payments and upcoming sessions (bookings:view)
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id, 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const c = await prisma.class.findUniqueOrThrow({
      where: { id },
      include: {
        sport: { select: { name: true } },
        enrollments: { include: { player: true, payments: { select: { kind: true, amount: true } } }, orderBy: [{ status: 'asc' }, { createdAt: 'asc' }] },
        venue: { select: { timezone: true, currency: true } },
      },
    })
    const tz = c.venue.timezone
    const upcoming = await prisma.courtBlock.count({ where: { classId: id, startTime: { gte: zonedToUtc(todayIn(tz), 0, tz) } } })
    const contact = hasPermission(ctx.access, 'bookings', 'edit')
    return NextResponse.json({
      id: c.id, name: c.name, coachName: c.coachName, sportId: c.sportId, sportName: c.sport?.name ?? null, courtIds: c.courtIds, days: c.days,
      startMin: c.startMin, endMin: c.endMin, startDate: c.startDate, endDate: c.endDate, capacity: c.capacity,
      fee: Number(c.fee), feePeriod: c.feePeriod, status: c.status, currency: c.venue.currency, upcomingSessions: upcoming,
      students: c.enrollments.map((e) => ({
        id: e.id, playerId: e.playerId, name: e.player.name, phone: contact ? e.player.phone : null,
        status: e.status, enrolledAt: e.createdAt.toISOString(), paid: netPaid(e.payments),
      })),
    })
  } catch (err) {
    return handleError(err, 'class GET')
  }
}

// PATCH /api/classes/:id — edit details or schedule (venue:edit). Schedule changes rewrite sessions from today.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    const r = await updateClass(prisma, ctx.access.venueId, ctx.userId, id, validateClass(await readJson(req), true))
    return NextResponse.json(r)
  } catch (err) {
    return handleError(err, 'class PATCH')
  }
}

// DELETE /api/classes/:id — cancel the class and free its future court time (venue:edit). History is kept.
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await cancelClass(prisma, ctx.access.venueId, id))
  } catch (err) {
    return handleError(err, 'class DELETE')
  }
}
