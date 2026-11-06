import { prisma } from '@/lib/db'
import type { VenuePermissions } from '@/lib/permissions'
import { jsonError, requireVenue, type Ctx } from './route-helpers'

/**
 * Resolve the venue that owns a booking and check the caller's access to it.
 * Bookings in venues the caller can't access are reported as 404 (not 403)
 * so IDs from other tenants can't be probed.
 */
export async function requireBookingAccess(bookingId: string, module: keyof VenuePermissions, level: 'view' | 'edit'): Promise<Ctx | Response> {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(bookingId)) return jsonError(404, 'Booking not found')
  const b = await prisma.booking.findUnique({ where: { id: bookingId }, select: { venueId: true } })
  if (!b) {
    const ctx = await requireVenue(null, 'bookings', 'view')
    return ctx instanceof Response && ctx.status === 401 ? ctx : jsonError(404, 'Booking not found')
  }
  const ctx = await requireVenue(b.venueId, module, level)
  if (ctx instanceof Response && ctx.status === 403) {
    const body = (await ctx.clone().json()) as { error: string }
    // Members of this venue lacking permission get a 403 with the reason; outsiders get 404.
    return body.error === 'Forbidden' ? jsonError(404, 'Booking not found') : ctx
  }
  return ctx
}
