import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn } from '@/lib/booking/time'
import { renewalsDue } from '@/lib/payments/service'

// GET /api/memberships/renewals?venueId&within=30&expired=60 — memberships ending soon or recently ended,
// not yet renewed (billing:view)
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'billing', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.access.venueId }, select: { timezone: true, currency: true } })
    const clamp = (v: string | null, d: number) => Math.min(Math.max(Number(v) || d, 0), 365)
    const today = todayIn(venue.timezone)
    const items = await renewalsDue(prisma, ctx.access.venueId, today, {
      withinDays: clamp(sp.get('within'), 30), expiredDays: clamp(sp.get('expired'), 60), contact: hasPermission(ctx.access, 'bookings', 'edit'),
    })
    return NextResponse.json({ today, currency: venue.currency, items })
  } catch (err) {
    return handleError(err, 'renewals GET')
  }
}
