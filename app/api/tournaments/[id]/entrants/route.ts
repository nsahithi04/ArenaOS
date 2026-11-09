import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson } from '@/lib/booking/route-helpers'
import { requireTournament } from '@/lib/tournaments/lookup'
import { addEntrant } from '@/lib/tournaments/service'
import { validateEntrant } from '@/lib/tournaments/validation'

// POST /api/tournaments/:id/entrants — register an entry, optionally with the entry fee (bookings:edit)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireTournament(id, 'bookings', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await addEntrant(prisma, ctx.access.venueId, ctx.userId, id, validateEntrant(await readJson(req))), { status: 201 })
  } catch (err) {
    return handleError(err, 'entrants POST')
  }
}
