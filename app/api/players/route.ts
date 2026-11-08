import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn } from '@/lib/booking/time'

// GET /api/players?venueId&q&date&membersOnly=1 — player search (for the booking form's member picker,
// selling memberships and enrolling students). Includes each player's membership valid on `date` (default today).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venueId = ctx.access.venueId
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })
    const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('date') ?? '') ? sp.get('date')! : todayIn(venue.timezone)
    const q = sp.get('q')?.trim().slice(0, 80) ?? ''
    const contact = hasPermission(ctx.access, 'bookings', 'edit')
    const membersOnly = sp.get('membersOnly') === '1'

    const players = await prisma.player.findMany({
      where: {
        venueId,
        ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, ...(contact ? [{ phone: { contains: q } }, { email: { contains: q, mode: 'insensitive' as const } }] : [])] }),
        ...(membersOnly && { memberships: { some: { status: 'ACTIVE', startDate: { lte: date }, endDate: { gte: date } } } }),
      },
      include: {
        memberships: {
          where: { status: 'ACTIVE', startDate: { lte: date }, endDate: { gte: date } },
          include: { plan: { select: { name: true, sportId: true } } },
          orderBy: { endDate: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
      take: 20,
    })
    return NextResponse.json(players.map((p) => ({
      id: p.id,
      name: p.name,
      phone: contact ? p.phone : null,
      email: contact ? p.email : null,
      membership: p.memberships[0]
        ? { id: p.memberships[0].id, planName: p.memberships[0].plan.name, sportId: p.memberships[0].plan.sportId, endDate: p.memberships[0].endDate }
        : null,
    })))
  } catch (err) {
    return handleError(err, 'players GET')
  }
}
