import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson } from '@/lib/booking/route-helpers'
import { requireTournament } from '@/lib/tournaments/lookup'
import { updateEntrant } from '@/lib/tournaments/service'

// PATCH /api/tournaments/:id/entrants/:entrantId — seed, rename or withdraw an entry before the draw (bookings:edit)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; entrantId: string }> }) {
  const { id, entrantId } = await params
  const ctx = await requireTournament(id, 'bookings', 'edit')
  if (ctx instanceof Response) return ctx
  if (!isId(entrantId)) return jsonError(404, 'Entry not found')
  try {
    const b = (await readJson(req)) as Record<string, unknown>
    const input: { seed?: number | null; withdrawn?: boolean; name?: string } = {}
    if ('seed' in b) {
      if (b.seed === null || b.seed === '') input.seed = null
      else if (!Number.isInteger(Number(b.seed)) || Number(b.seed) < 1 || Number(b.seed) > 256) return jsonError(400, 'Seed must be 1–256')
      else input.seed = Number(b.seed)
    }
    if ('withdrawn' in b) input.withdrawn = b.withdrawn === true
    if (typeof b.name === 'string' && b.name.trim()) input.name = b.name.trim().slice(0, 120)
    const e = await prisma.tournamentEntrant.findFirst({ where: { id: entrantId, tournamentId: id } })
    if (!e) return jsonError(404, 'Entry not found')
    await updateEntrant(prisma, ctx.access.venueId, entrantId, input)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'entrant PATCH')
  }
}
