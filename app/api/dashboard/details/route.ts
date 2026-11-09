import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingSelect, toBookingDTO } from '@/lib/booking/queries'
import { resolveRange } from '@/lib/booking/ranges'
import { handleError, jsonError, requireVenue } from '@/lib/booking/route-helpers'
import { isLocalDate, localDateOf, localMinutesOf, localRangeToUtc, todayIn } from '@/lib/booking/time'
import { BOOKING_SOURCES } from '@/lib/booking/validation'

// GET /api/dashboard/details?kind=…&range=…[&from&to][&date][&courtId][&sportId][&source]
//
// The records behind each dashboard figure (owners/managers only; no customer contact details):
//   kind=payments       payments and refunds received in the range       → Collected revenue
//   kind=bookings       non-cancelled bookings played in the range        → Total bookings / Booked value / breakdowns / chart days
//   kind=pending        non-cancelled bookings in the range with a balance → Pending payments
//   kind=cancellations  cancelled bookings in the range                   → Cancellations
// `date=YYYY-MM-DD` narrows any kind to a single day (used by "Today" and chart clicks).
const KINDS = ['payments', 'bookings', 'pending', 'cancellations'] as const
type Kind = (typeof KINDS)[number]
const LIMIT = 500

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'reports', 'view')
  if (ctx instanceof Response) return ctx

  try {
    const kind = sp.get('kind') as Kind
    if (!KINDS.includes(kind)) return jsonError(400, `kind must be one of: ${KINDS.join(', ')}`)
    const venueId = ctx.access.venueId
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true, currency: true } })
    const tz = venue.timezone

    let from: string
    let to: string
    const date = sp.get('date')
    if (date) {
      if (!isLocalDate(date)) return jsonError(400, 'date must be YYYY-MM-DD')
      from = to = date
    } else {
      const r = resolveRange(sp, todayIn(tz))
      if (!r.ok) return jsonError(400, r.error)
      ;({ from, to } = r)
    }
    const { start, end } = localRangeToUtc(from, to, tz)

    const id = (v: string | null) => (v && /^[a-zA-Z0-9_-]{1,64}$/.test(v) ? v : undefined)
    const courtId = id(sp.get('courtId'))
    const sportId = id(sp.get('sportId'))
    const sportName = sp.get('sportName')?.slice(0, 60) || undefined // legacy bookings without a sport link
    const sources = sp.get('source')?.split(',').filter((s) => (BOOKING_SOURCES as readonly string[]).includes(s))

    const bookingFilter: Prisma.BookingWhereInput = {
      venueId,
      ...(courtId && { courtId }),
      ...(sportId && { sportId }),
      ...(!sportId && sportName && { sportId: null, sport: sportName }),
      ...(sources?.length && { source: { in: sources as never } }),
    }

    if (kind === 'payments') {
      // Court/sport/source filters only apply to booking payments; otherwise include memberships and classes too.
      const category = sp.get('category')
      const bookingOnly = !!(courtId || sportId || sportName || sources?.length) || category === 'BOOKING'
      const where: Prisma.PaymentWhereInput = {
        venueId,
        receivedAt: { gte: start, lt: end },
        ...(bookingOnly && { booking: bookingFilter }),
        ...(category === 'MEMBERSHIP' && { membershipId: { not: null } }),
        ...(category === 'CLASS' && { enrollmentId: { not: null } }),
        ...(category === 'TOURNAMENT' && { tournamentEntryId: { not: null } }),
      }
      const rows = await prisma.payment.findMany({
        where,
        select: {
          id: true, kind: true, method: true, amount: true, receivedAt: true, bookingId: true,
          booking: { select: { customer: true, startTime: true, court: { select: { name: true } } } },
          membership: { select: { player: { select: { name: true } }, plan: { select: { name: true } } } },
          enrollment: { select: { player: { select: { name: true } }, class: { select: { name: true } } } },
          tournamentEntry: { select: { name: true, tournament: { select: { name: true } } } },
        },
        orderBy: { receivedAt: 'desc' },
        take: LIMIT,
      })
      return NextResponse.json({
        kind, from, to, currency: venue.currency, truncated: rows.length === LIMIT,
        payments: rows.map((p) => ({
          id: p.id,
          kind: p.kind,
          method: p.method,
          amount: Number(p.amount),
          receivedDate: localDateOf(p.receivedAt, tz),
          receivedMin: localMinutesOf(p.receivedAt, tz),
          bookingId: p.bookingId,
          customer: p.booking?.customer ?? p.membership?.player.name ?? p.enrollment?.player.name ?? p.tournamentEntry?.name ?? '—',
          // For membership/class payments this column describes what was paid for.
          courtName: p.booking?.court.name
            ?? (p.membership ? `Membership · ${p.membership.plan.name}`
              : p.enrollment ? `Class · ${p.enrollment.class.name}`
              : `Tournament · ${p.tournamentEntry?.tournament.name ?? ''}`),
          bookingDate: p.booking ? localDateOf(p.booking.startTime, tz) : null,
        })),
      })
    }

    const where: Prisma.BookingWhereInput = {
      ...bookingFilter,
      startTime: { gte: start, lt: end },
      status: kind === 'cancellations' ? 'CANCELLED' : { not: 'CANCELLED' },
    }
    const rows = await prisma.booking.findMany({ where, select: bookingSelect, orderBy: { startTime: 'asc' }, take: LIMIT })
    let items = rows.map((b) => toBookingDTO(b, tz, { includeContact: false }))
    if (kind === 'pending') items = items.filter((b) => b.balance > 0)

    return NextResponse.json({ kind, from, to, currency: venue.currency, truncated: rows.length === LIMIT, bookings: items })
  } catch (err) {
    return handleError(err, 'dashboard details GET')
  }
}
