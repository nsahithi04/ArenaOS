import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, readJson } from '@/lib/booking/route-helpers'
import { localDateOf, localMinutesOf, todayIn, zonedToUtc } from '@/lib/booking/time'
import { netPaid } from '@/lib/club/service'
import { placings, roundName } from '@/lib/tournaments/bracket'
import { requireTournament } from '@/lib/tournaments/lookup'
import { cancelTournament, prizePool, updateTournament } from '@/lib/tournaments/service'
import { validateTournament, type Prize } from '@/lib/tournaments/validation'

type Params = { params: Promise<{ id: string }> }

// GET /api/tournaments/:id — everything needed to run the tournament: entries, bracket, placings, prizes (bookings:view)
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireTournament(id, 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const t = await prisma.tournament.findUniqueOrThrow({
      where: { id },
      include: {
        venue: { select: { timezone: true, currency: true } },
        sport: { select: { name: true } },
        entrants: { include: { payments: { select: { kind: true, amount: true } } }, orderBy: [{ withdrawn: 'asc' }, { seed: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] },
        matches: { orderBy: [{ round: 'asc' }, { position: 'asc' }] },
      },
    })
    const tz = t.venue.timezone
    const contact = hasPermission(ctx.access, 'bookings', 'edit')
    const totalRounds = t.matches.reduce((m, x) => Math.max(m, x.round), 0)
    const upcomingSessions = await prisma.courtBlock.count({ where: { tournamentId: id, startTime: { gte: zonedToUtc(todayIn(tz), 0, tz) } } })
    const fee = Number(t.entryFee)
    const name = new Map(t.entrants.map((e) => [e.id, e.name]))
    const prizes = (t.prizes as unknown as Prize[]) ?? []
    const places = placings(t.matches, totalRounds)

    return NextResponse.json({
      id: t.id, name: t.name, description: t.description, sportId: t.sportId, sportName: t.sport?.name ?? null, courtIds: t.courtIds,
      startDate: t.startDate, endDate: t.endDate, startMin: t.startMin, endMin: t.endMin, entryType: t.entryType,
      maxEntrants: t.maxEntrants, entryFee: fee, prizes, prizePool: prizePool(prizes), status: t.status, currency: t.venue.currency,
      timezone: tz, upcomingSessions, totalRounds,
      winnerName: t.winnerEntrantId ? name.get(t.winnerEntrantId) ?? null : null,
      entrants: t.entrants.map((e) => {
        const paid = netPaid(e.payments)
        return { id: e.id, name: e.name, playerId: e.playerId, phone: contact ? e.phone : null, seed: e.seed, withdrawn: e.withdrawn, paid, balance: Math.max(0, Math.round((fee - paid) * 100) / 100) }
      }),
      rounds: Array.from({ length: totalRounds }, (_, i) => ({
        round: i + 1,
        name: roundName(i + 1, totalRounds),
        matches: t.matches.filter((m) => m.round === i + 1).map((m) => ({
          id: m.id, round: m.round, position: m.position, status: m.status, score: m.score,
          entrantAId: m.entrantAId, entrantBId: m.entrantBId, winnerId: m.winnerId,
          entrantA: m.entrantAId ? name.get(m.entrantAId) ?? '?' : null,
          entrantB: m.entrantBId ? name.get(m.entrantBId) ?? '?' : null,
          courtId: m.courtId,
          date: m.scheduledAt ? localDateOf(m.scheduledAt, tz) : null,
          startMin: m.scheduledAt ? localMinutesOf(m.scheduledAt, tz) : null,
        })),
      })),
      placings: places.map((p, i) => ({ ...p, names: p.entrantIds.map((x) => name.get(x) ?? '?'), prize: prizes[i] ?? null })),
    })
  } catch (err) {
    return handleError(err, 'tournament GET')
  }
}

// PATCH /api/tournaments/:id — edit details, schedule or prizes (venue:edit). Schedule changes re-reserve courts from today.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireTournament(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await updateTournament(prisma, ctx.access.venueId, ctx.userId, id, validateTournament(await readJson(req), true)))
  } catch (err) {
    return handleError(err, 'tournament PATCH')
  }
}

// DELETE /api/tournaments/:id — cancel and release future court time (venue:edit)
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireTournament(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await cancelTournament(prisma, ctx.access.venueId, id))
  } catch (err) {
    return handleError(err, 'tournament DELETE')
  }
}
