import { NextResponse } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { computeMetrics, type MetricBooking, type MetricPayment } from '@/lib/booking/metrics'
import { bookingSelect, toBookingDTO } from '@/lib/booking/queries'
import { handleError, jsonError, requireVenue } from '@/lib/booking/route-helpers'
import { loadVenueConfig } from '@/lib/booking/service'
import { addDays, diffDays, endOfMonth, isLocalDate, localRangeToUtc, startOfMonth, startOfWeek, todayIn } from '@/lib/booking/time'

async function metricsFor(db: PrismaClient, venueId: string, cfg: Awaited<ReturnType<typeof loadVenueConfig>>, from: string, to: string) {
  const { start, end } = localRangeToUtc(from, to, cfg.timezone)
  const [bookings, payments] = await Promise.all([
    db.booking.findMany({
      where: { venueId, startTime: { gte: start, lt: end } },
      select: { id: true, courtId: true, sportId: true, sport: true, source: true, status: true, startTime: true, endTime: true, amountUsd: true, sportRef: { select: { name: true } } },
    }),
    db.payment.findMany({
      where: { venueId, receivedAt: { gte: start, lt: end } },
      select: { bookingId: true, kind: true, amount: true, receivedAt: true, booking: { select: { courtId: true, sportId: true, sport: true, source: true, sportRef: { select: { name: true } } } } },
    }),
  ])
  const ids = bookings.filter((b) => b.status !== 'CANCELLED').map((b) => b.id)
  const sums = ids.length
    ? await db.payment.groupBy({ by: ['bookingId', 'kind'], where: { bookingId: { in: ids } }, _sum: { amount: true } })
    : []
  const netPaid = new Map<string, number>()
  for (const s of sums) {
    const v = Number(s._sum.amount ?? 0) * (s.kind === 'PAYMENT' ? 1 : -1)
    netPaid.set(s.bookingId, (netPaid.get(s.bookingId) ?? 0) + v)
  }
  return computeMetrics({
    tz: cfg.timezone,
    from,
    to,
    bookings: bookings.map<MetricBooking>((b) => ({
      id: b.id, courtId: b.courtId, sportId: b.sportId, sportName: b.sportRef?.name ?? b.sport, source: b.source,
      status: b.status, startTime: b.startTime, endTime: b.endTime, amount: Number(b.amountUsd),
    })),
    payments: payments.map<MetricPayment>((p) => ({
      bookingId: p.bookingId, kind: p.kind, amount: Number(p.amount), receivedAt: p.receivedAt, courtId: p.booking.courtId,
      sportId: p.booking.sportId, sportName: p.booking.sportRef?.name ?? p.booking.sport, source: p.booking.source,
    })),
    netPaidByBooking: netPaid,
    courts: cfg.courts,
    hours: cfg.hours,
  })
}

// GET /api/dashboard?venueId&range=today|week|month|custom&from&to
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx

  try {
    const venueId = ctx.access.venueId
    const cfg = await loadVenueConfig(prisma, venueId)
    const today = todayIn(cfg.timezone)
    const range = sp.get('range') ?? 'week'

    let from: string
    let to: string
    if (range === 'today') [from, to] = [today, today]
    else if (range === 'month') [from, to] = [startOfMonth(today), endOfMonth(today)]
    else if (range === 'custom') {
      const f = sp.get('from')
      const t = sp.get('to')
      if (!isLocalDate(f) || !isLocalDate(t)) return jsonError(400, 'Custom range needs from and to (YYYY-MM-DD)')
      if (diffDays(f, t) < 0) return jsonError(400, '"from" must be on or before "to"')
      if (diffDays(f, t) > 366) return jsonError(400, 'Custom range can be at most one year')
      ;[from, to] = [f, t]
    } else [from, to] = [startOfWeek(today), addDays(startOfWeek(today), 6)]

    const len = diffDays(from, to) + 1
    const prevTo = addDays(from, -1)
    const prevFrom = addDays(prevTo, -(len - 1))

    const now = new Date()
    const [current, previous, todayMetrics, upcoming, recent, liveNow] = await Promise.all([
      metricsFor(prisma, venueId, cfg, from, to),
      metricsFor(prisma, venueId, cfg, prevFrom, prevTo),
      range === 'today' ? null : metricsFor(prisma, venueId, cfg, today, today),
      prisma.booking.findMany({
        where: { venueId, status: { in: ['PENDING', 'CONFIRMED'] }, startTime: { gte: now } },
        select: bookingSelect,
        orderBy: { startTime: 'asc' },
        take: 6,
      }),
      prisma.booking.findMany({ where: { venueId }, select: bookingSelect, orderBy: { createdAt: 'desc' }, take: 6 }),
      prisma.booking.findMany({
        where: { venueId, status: { not: 'CANCELLED' }, startTime: { lte: now }, endTime: { gt: now } },
        select: { courtId: true },
        distinct: ['courtId'],
      }),
    ])
    const t = todayMetrics ?? current

    // Revenue figures require reports:view. Counts and occupancy only need bookings:view.
    const canSeeRevenue = hasPermission(ctx.access, 'reports', 'view')
    const strip = <T extends Record<string, unknown>>(m: T) => (canSeeRevenue ? m : redactRevenue(m))

    // Dashboard lists never include customer contact details.
    const dto = (b: (typeof upcoming)[number]) => {
      const d = toBookingDTO(b, cfg.timezone, { includeContact: false })
      return canSeeRevenue ? d : { ...d, amount: null, paid: null, refunded: null, balance: null }
    }

    return NextResponse.json({
      venue: { id: cfg.id, name: cfg.name, timezone: cfg.timezone, currency: cfg.currency },
      today,
      range: { key: range, from, to, previousFrom: prevFrom, previousTo: prevTo },
      canSeeRevenue,
      current: strip(current),
      previous: strip({ gross: previous.gross, collected: previous.collected, bookings: previous.bookings, occupancy: previous.occupancy, cancellations: previous.cancellations }),
      today_: strip({ gross: t.gross, collected: t.collected, bookings: t.bookings, pending: t.pending }),
      upcoming: upcoming.map(dto),
      recent: recent.map(dto),
      courtsInUseNow: liveNow.length,
      activeCourts: cfg.courts.filter((c) => c.isActive).length,
    })
  } catch (err) {
    return handleError(err, 'dashboard GET')
  }
}

function redactRevenue<T extends Record<string, unknown>>(m: T): T {
  const money = new Set(['gross', 'collected', 'paymentsReceived', 'refunds', 'outstanding', 'value'])
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, money.has(k) ? null : walk(x)]))
    }
    return v
  }
  return walk(m) as T
}
