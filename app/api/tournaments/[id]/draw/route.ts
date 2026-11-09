import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson } from '@/lib/booking/route-helpers'
import { requireTournament } from '@/lib/tournaments/lookup'
import { drawBracket } from '@/lib/tournaments/service'

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
