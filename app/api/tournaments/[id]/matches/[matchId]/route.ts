import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson } from '@/lib/booking/route-helpers'
import { requireTournament } from '@/lib/tournaments/lookup'
import { updateMatch } from '@/lib/tournaments/service'
import { validateMatchUpdate } from '@/lib/tournaments/validation'

// PATCH /api/tournaments/:id/matches/:matchId — record/correct a result ({ winnerId, score, walkover } or { undo: true })
// and/or schedule it ({ courtId, date, start }). bookings:edit, so front desk can run the matches.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; matchId: string }> }) {
  const { id, matchId } = await params
  const ctx = await requireTournament(id, 'bookings', 'edit')
  if (ctx instanceof Response) return ctx
  if (!isId(matchId)) return jsonError(404, 'Match not found')
  try {
    const m = await prisma.tournamentMatch.findFirst({ where: { id: matchId, tournamentId: id }, select: { id: true } })
    if (!m) return jsonError(404, 'Match not found')
    return NextResponse.json(await updateMatch(prisma, ctx.access.venueId, matchId, validateMatchUpdate(await readJson(req))))
  } catch (err) {
    return handleError(err, 'match PATCH')
  }
}
