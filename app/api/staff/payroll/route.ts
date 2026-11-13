import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { payrollReport } from '@/lib/staff/service'
import { actorOf, payRange, venueToday } from '@/lib/staff/routes'

// GET /api/staff/payroll?venueId&range=month|lastmonth|week|custom&from&to
// Hours scheduled vs worked, pay earned, payouts and balance — only for people the caller may see pay for.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'team', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const v = await venueToday(ctx.access.venueId)
    const r = payRange(sp, v.today)
    if (r instanceof Response) return r
    return NextResponse.json(await payrollReport(prisma, ctx.access.venueId, actorOf(ctx), r.from, r.to))
  } catch (err) {
    return handleError(err, 'payroll GET')
  }
}
