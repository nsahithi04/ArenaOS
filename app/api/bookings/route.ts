import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission, lockActorOf } from '@/lib/booking/access'
import { buildWhere, findBookings, parseFilters, toBookingDTO } from '@/lib/booking/queries'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { createBooking } from '@/lib/booking/service'
import { diffDays } from '@/lib/booking/time'
import { validateCreateBooking } from '@/lib/booking/validation'

// GET /api/bookings?venueId&from&to&courtId&sportId&source&status&payment&q&page&pageSize&order&format=csv
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx

  try {
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.access.venueId }, select: { timezone: true, currency: true } })
    const filters = parseFilters(sp)
    const includeContact = hasPermission(ctx.access, 'bookings', 'edit')
    const where = buildWhere(ctx.access.venueId, venue.timezone, filters, { searchContact: includeContact })
    const order = sp.get('order') === 'desc' ? 'desc' : 'asc'

    // Calendar views fetch a whole bounded range in one go; lists paginate.
    const boundedRange = filters.from && filters.to && diffDays(filters.from, filters.to) <= 42
    const maxPageSize = sp.get('format') === 'csv' ? 10_000 : boundedRange ? 2000 : 100
    const pageSize = Math.min(Math.max(Number(sp.get('pageSize')) || 25, 1), maxPageSize)
    const page = Math.max(Number(sp.get('page')) || 1, 1)

    const { items, total } = await findBookings(prisma, where, page, pageSize, order)
    const dtos = items.map((b) => toBookingDTO(b, venue.timezone, { includeContact }))

    if (sp.get('format') === 'csv') return csv(dtos, includeContact)
    return NextResponse.json({ items: dtos, total, page, pageSize, timezone: venue.timezone, currency: venue.currency })
  } catch (err) {
    return handleError(err, 'bookings GET')
  }
}

// POST /api/bookings — create a booking (including walk-ins: source = WALK_IN)
export async function POST(req: Request) {
  try {
    const input = validateCreateBooking(await readJson(req))
    const ctx = await requireVenue(input.venueId, 'bookings', 'edit')
    if (ctx instanceof Response) return ctx

    const result = await createBooking(prisma, ctx.access.venueId, ctx.userId, input, lockActorOf(ctx.access))
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'bookings POST')
  }
}

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v)
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csv(rows: ReturnType<typeof toBookingDTO>[], includeContact: boolean) {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const header = ['Ref', 'Date', 'Start', 'End', 'Court', 'Sport', 'Customer', ...(includeContact ? ['Phone', 'Email'] : []), 'Source', 'Status', 'Payment', 'Amount', 'Paid', 'Refunded', 'Balance', 'Notes']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [r.ref, r.date, hhmm(r.startMin), hhmm(r.endMin), r.courtName, r.sportName, r.customer, ...(includeContact ? [r.phone, r.email] : []), r.source, r.status, r.payment, r.amount.toFixed(2), r.paid.toFixed(2), r.refunded.toFixed(2), r.balance.toFixed(2), r.notes]
        .map(csvCell)
        .join(','),
    )
  }
  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bookings.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
