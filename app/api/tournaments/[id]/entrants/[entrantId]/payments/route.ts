import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson } from '@/lib/booking/route-helpers'
import { validateClubPayment } from '@/lib/club/validation'
import { requireTournament } from '@/lib/tournaments/lookup'
import { payEntry } from '@/lib/tournaments/service'

// POST /api/tournaments/:id/entrants/:entrantId/payments — record an entry fee payment (bookings:edit)
export async function POST(req: Request, { params }: { params: Promise<{ id: string; entrantId: string }> }) {
  const { id, entrantId } = await params
  const ctx = await requireTournament(id, 'bookings', 'edit')
  if (ctx instanceof Response) return ctx
  if (!isId(entrantId)) return jsonError(404, 'Entry not found')
  try {
    const e = await prisma.tournamentEntrant.findFirst({ where: { id: entrantId, tournamentId: id } })
    if (!e) return jsonError(404, 'Entry not found')
    return NextResponse.json(await payEntry(prisma, ctx.access.venueId, ctx.userId, entrantId, validateClubPayment(await readJson(req))), { status: 201 })
  } catch (err) {
    return handleError(err, 'entry payment POST')
  }
}
