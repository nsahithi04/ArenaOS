import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkOperatingHours } from '@/lib/booking/availability'
import { ValidationError } from '@/lib/booking/validation'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { loadVenueConfig, priceFor } from '@/lib/booking/service'
import { formatMinutes, isLocalDate, localMinutesOf, parseClock, zonedToUtc } from '@/lib/booking/time'

// POST /api/bookings/quote — price + availability preview for the booking form.
// Advisory only: the authoritative check runs again inside the create/update transaction.
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'bookings', 'view')
    if (ctx instanceof Response) return ctx

    const { courtId, sportId, date, start, end, excludeBookingId } = body
    const errors: Record<string, string> = {}
    if (typeof courtId !== 'string') errors.courtId = 'Court is required'
    if (!isLocalDate(date)) errors.date = 'Date must be YYYY-MM-DD'
    const s = typeof start === 'string' ? parseClock(start) : null
    let e = typeof end === 'string' ? parseClock(end) : null
    if (e === 0) e = 1440
    if (s == null) errors.start = 'Start is required'
    if (e == null || (s != null && e <= s) || (e ?? 0) > 1440) errors.end = 'End must be after start'
    if (Object.keys(errors).length) throw new ValidationError(errors)

    const cfg = await loadVenueConfig(prisma, ctx.access.venueId)
    const court = cfg.courts.find((c) => c.id === courtId)
    if (!court) throw new ValidationError({ courtId: 'Court not found' })
    const sport = typeof sportId === 'string' && sportId ? sportId : court.sportId

    const quote = priceFor(cfg, court.id, sport, date as string, s!, e!)
    const hours = checkOperatingHours(cfg.hours, sport, date as string, s!, e!)

    const startAt = zonedToUtc(date as string, s!, cfg.timezone)
    const endAt = zonedToUtc(date as string, e!, cfg.timezone)
    const [clash, block] = await Promise.all([
      prisma.booking.findFirst({
        where: {
          courtId: court.id,
          status: { not: 'CANCELLED' },
          startTime: { lt: endAt },
          endTime: { gt: startAt },
          ...(typeof excludeBookingId === 'string' && { id: { not: excludeBookingId } }),
        },
        select: { startTime: true, endTime: true },
      }),
      prisma.courtBlock.findFirst({
        where: { courtId: court.id, startTime: { lt: endAt }, endTime: { gt: startAt } },
        select: { startTime: true, endTime: true, reason: true },
      }),
    ])
    const fmt = (d: Date) => formatMinutes(localMinutesOf(d, cfg.timezone))
    const conflict = clash
      ? `Already booked ${fmt(clash.startTime)} – ${fmt(clash.endTime)}`
      : block
        ? `Blocked${block.reason ? ` (${block.reason})` : ''} ${fmt(block.startTime)} – ${fmt(block.endTime)}`
        : null

    return NextResponse.json({
      amount: quote.total,
      segments: quote.segments,
      uncoveredMinutes: quote.uncoveredMinutes,
      available: !conflict && court.isActive && court.isAvailable,
      conflict: conflict ?? (!court.isActive || !court.isAvailable ? `${court.name} is not available` : null),
      hours: hours.ok
        ? { ok: true }
        : { ok: false, message: hours.reason === 'closed' ? 'Closed on this day' : `Outside operating hours (${formatMinutes(hours.open ?? 0)} – ${formatMinutes(hours.close ?? 0)})` },
      currency: cfg.currency,
    })
  } catch (err) {
    return handleError(err, 'bookings quote')
  }
}
