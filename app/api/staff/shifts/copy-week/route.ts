import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { isLocalDate } from '@/lib/booking/time'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { copyWeek } from '@/lib/staff/service'
import { actorOf } from '@/lib/staff/routes'

// POST /api/staff/shifts/copy-week { fromWeek, toWeek } — copy a week's shifts as drafts (clashes skipped)
export async function POST(req: Request) {
  try {
    const b = (await readJson(req)) as Record<string, unknown>
    if (!isLocalDate(b.fromWeek) || !isLocalDate(b.toWeek) || b.fromWeek === b.toWeek) return jsonError(400, 'fromWeek and toWeek dates are required')
    const ctx = await requireVenue(typeof b.venueId === 'string' ? b.venueId : null, 'team', 'edit')
    if (ctx instanceof Response) return ctx
    return NextResponse.json(await copyWeek(prisma, ctx.access.venueId, actorOf(ctx), b.fromWeek as string, b.toWeek as string))
  } catch (err) {
    return handleError(err, 'copy-week POST')
  }
}
