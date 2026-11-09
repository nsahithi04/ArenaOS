import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn } from '@/lib/booking/time'
import { createTournament, prizePool } from '@/lib/tournaments/service'
import { validateTournament, type TournamentInput } from '@/lib/tournaments/validation'

// GET /api/tournaments?venueId&status=current|all — tournaments with entry counts (bookings:view)
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venueId = ctx.access.venueId
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true, currency: true } })
    const today = todayIn(venue.timezone)
    const all = sp.get('status') === 'all'
    const rows = await prisma.tournament.findMany({
      where: { venueId, ...(!all && { OR: [{ status: { in: ['REGISTRATION', 'IN_PROGRESS'] } }, { endDate: { gte: today }, status: { not: 'CANCELLED' } }] }) },
      include: {
        sport: { select: { name: true, emoji: true } },
        _count: { select: { entrants: { where: { withdrawn: false } } } },
        entrants: { where: { withdrawn: false }, select: { id: true, name: true } },
      },
      orderBy: [{ startDate: 'asc' }],
    })
    const courts = await prisma.court.findMany({ where: { venueId }, select: { id: true, name: true } })
    const courtName = new Map(courts.map((c) => [c.id, c.name]))
    return NextResponse.json({
      today,
      currency: venue.currency,
      items: rows.map((t) => ({
        id: t.id, name: t.name, sportName: t.sport?.name ?? null, sportEmoji: t.sport?.emoji ?? null, status: t.status,
        startDate: t.startDate, endDate: t.endDate, startMin: t.startMin, endMin: t.endMin, entryType: t.entryType,
        courtNames: t.courtIds.map((id) => courtName.get(id) ?? 'Removed court'),
        entries: t._count.entrants, maxEntrants: t.maxEntrants, entryFee: Number(t.entryFee), prizePool: prizePool(t.prizes),
        winnerName: t.winnerEntrantId ? t.entrants.find((e) => e.id === t.winnerEntrantId)?.name ?? null : null,
      })),
    })
  } catch (err) {
    return handleError(err, 'tournaments GET')
  }
}

// POST /api/tournaments — create a tournament and reserve its courts (venue:edit). 409 lists clashes unless skipConflicts.
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const input = validateTournament(body)
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'venue', 'edit')
    if (ctx instanceof Response) return ctx
    return NextResponse.json(await createTournament(prisma, ctx.access.venueId, ctx.userId, input as TournamentInput & { skipConflicts: boolean }), { status: 201 })
  } catch (err) {
    return handleError(err, 'tournaments POST')
  }
}
