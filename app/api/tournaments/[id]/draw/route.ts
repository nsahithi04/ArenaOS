import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson } from '@/lib/booking/route-helpers'
import { requireTournament } from '@/lib/tournaments/lookup'
import { drawBracket, reopenRegistration } from '@/lib/tournaments/service'

// POST /api/tournaments/:id/draw { random?: boolean } — make or redo the knockout draw (venue:edit).
// Seeds are placed first; unseeded entries are shuffled when random, else kept in registration order.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireTournament(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    const { random } = (await readJson(req)) as { random?: boolean }
    return NextResponse.json(await drawBracket(prisma, ctx.access.venueId, id, { random: random !== false }))
  } catch (err) {
    return handleError(err, 'draw POST')
  }
}

// DELETE /api/tournaments/:id/draw — undo the draw and reopen registration (venue:edit).
// Refused once any real result is recorded.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireTournament(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await reopenRegistration(prisma, ctx.access.venueId, id))
  } catch (err) {
    return handleError(err, 'draw DELETE')
  }
}
