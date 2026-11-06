import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { loadVenueConfig } from '@/lib/booking/service'
import { todayIn } from '@/lib/booking/time'

// GET /api/booking-context?venueId — everything the booking screens need to render:
// venue timezone/currency, courts, sports, operating hours and the caller's effective permissions.
export async function GET(req: Request) {
  const ctx = await requireVenue(new URL(req.url).searchParams.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const cfg = await loadVenueConfig(prisma, ctx.access.venueId)
    return NextResponse.json({
      venue: { id: cfg.id, name: cfg.name, timezone: cfg.timezone, currency: cfg.currency },
      today: todayIn(cfg.timezone),
      courts: cfg.courts,
      sports: cfg.sports,
      hours: cfg.hours,
      permissions: {
        isOwner: ctx.access.isOwner,
        canEditBookings: hasPermission(ctx.access, 'bookings', 'edit'),
        canRefund: hasPermission(ctx.access, 'billing', 'edit'),
        canViewReports: hasPermission(ctx.access, 'reports', 'view'),
      },
    })
  } catch (err) {
    return handleError(err, 'booking-context GET')
  }
}
