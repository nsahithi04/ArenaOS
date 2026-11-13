import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { createShift, type ShiftInput } from '@/lib/staff/service'
import { validateShift } from '@/lib/staff/validation'
import { actorOf } from '@/lib/staff/routes'

// POST /api/staff/shifts — add a draft shift (team:edit; managers only for people they manage and themselves)
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const input = validateShift(body) as ShiftInput
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'team', 'edit')
    if (ctx instanceof Response) return ctx
    const s = await createShift(prisma, ctx.access.venueId, actorOf(ctx), input)
    return NextResponse.json({ id: s.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'shift POST')
  }
}
