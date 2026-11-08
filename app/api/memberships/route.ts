import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn } from '@/lib/booking/time'
import { membershipState } from '@/lib/club/schedule'
import { netPaid, sellMembership } from '@/lib/club/service'
import { validateSellMembership } from '@/lib/club/validation'

// GET /api/memberships?venueId&status=current|expired|all&q — memberships with player, plan and balance (bookings:view)
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venueId = ctx.access.venueId
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true, currency: true } })
    const today = todayIn(venue.timezone)
    const status = sp.get('status') ?? 'current'
    const q = sp.get('q')?.trim().slice(0, 80)
    const contact = hasPermission(ctx.access, 'bookings', 'edit')
    const rows = await prisma.membership.findMany({
      where: {
        venueId,
        ...(status === 'current' && { status: 'ACTIVE', endDate: { gte: today } }),
        ...(status === 'expired' && { OR: [{ status: 'CANCELLED' }, { endDate: { lt: today } }] }),
        ...(q && { player: { name: { contains: q, mode: 'insensitive' } } }),
      },
      include: {
        player: true,
        plan: { select: { name: true, sport: { select: { name: true } } } },
        payments: { select: { kind: true, amount: true } },
        _count: { select: { bookings: true } },
      },
      orderBy: [{ endDate: status === 'expired' ? 'desc' : 'asc' }],
      take: 300,
    })
    return NextResponse.json({
      today,
      currency: venue.currency,
      items: rows.map((m) => {
        const paid = netPaid(m.payments)
        return {
          id: m.id, playerId: m.playerId, playerName: m.player.name,
          phone: contact ? m.player.phone : null, email: contact ? m.player.email : null,
          planName: m.plan.name, sportName: m.plan.sport?.name ?? null,
          startDate: m.startDate, endDate: m.endDate, state: membershipState(m, today),
          price: Number(m.price), paid, balance: Math.max(0, Math.round((Number(m.price) - paid) * 100) / 100),
          bookings: m._count.bookings,
        }
      }),
    })
  } catch (err) {
    return handleError(err, 'memberships GET')
  }
}

// POST /api/memberships — sell a membership (bookings:edit, so front desk can sell)
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const input = validateSellMembership(body)
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'bookings', 'edit')
    if (ctx instanceof Response) return ctx
    const r = await sellMembership(prisma, ctx.access.venueId, ctx.userId, input)
    return NextResponse.json(r, { status: 201 })
  } catch (err) {
    return handleError(err, 'memberships POST')
  }
}
