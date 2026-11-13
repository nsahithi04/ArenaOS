import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isLocalDate } from '@/lib/booking/time'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { publishShifts } from '@/lib/staff/service'
import { actorOf } from '@/lib/staff/routes'

// POST /api/staff/shifts/publish { from, to } — publish drafts and notify each person (email + in-app)
export async function POST(req: Request) {
  try {
    const b = (await readJson(req)) as Record<string, unknown>
    if (!isLocalDate(b.from) || !isLocalDate(b.to) || b.to < b.from) return jsonError(400, 'from and to dates are required')
    const ctx = await requireVenue(typeof b.venueId === 'string' ? b.venueId : null, 'team', 'edit')
    if (ctx instanceof Response) return ctx
    return NextResponse.json(await publishShifts(prisma, ctx.access.venueId, actorOf(ctx), b.from as string, b.to as string))
  } catch (err) {
    return handleError(err, 'publish POST')
  }
}
