import { NextResponse } from 'next/server'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { computeMetrics, type MetricBooking, type MetricPayment } from '@/lib/booking/metrics'
import { bookingSelect, toBookingDTO } from '@/lib/booking/queries'
import { handleError, jsonError, requireVenue } from '@/lib/booking/route-helpers'
import { loadVenueConfig } from '@/lib/booking/service'
import { addDays, diffDays, localMinutesOf, localRangeToUtc, todayIn } from '@/lib/booking/time'
import { resolveRange } from '@/lib/booking/ranges'

async function metricsFor(db: PrismaClient, venueId: string, cfg: Awaited<ReturnType<typeof loadVenueConfig>>, from: string, to: string) {
  const { start, end } = localRangeToUtc(from, to, cfg.timezone)
  const [bookings, payments] = await Promise.all([
    db.booking.findMany({
      where: { venueId, startTime: { gte: start, lt: end } },
      select: { id: true, courtId: true, sportId: true, sport: true, source: true, status: true, startTime: true, endTime: true, amountUsd: true, sportRef: { select: { name: true } } },
    }),
    db.payment.findMany({
      where: { venueId, receivedAt: { gte: start, lt: end } },
      select: {
        bookingId: true, membershipId: true, enrollmentId: true, tournamentEntryId: true, kind: true, amount: true, receivedAt: true,
        booking: { select: { courtId: true, sportId: true, sport: true, source: true, sportRef: { select: { name: true } } } },
      },
    }),
  ])
  const ids = bookings.filter((b) => b.status !== 'CANCELLED').map((b) => b.id)
  const sums = ids.length
    ? await db.payment.groupBy({ by: ['bookingId', 'kind'], where: { bookingId: { in: ids } }, _sum: { amount: true } })
    : []
  const netPaid = new Map<string, number>()
  for (const s of sums) {
    const v = Number(s._sum.amount ?? 0) * (s.kind === 'PAYMENT' ? 1 : -1)
    if (s.bookingId) netPaid.set(s.bookingId, (netPaid.get(s.bookingId) ?? 0) + v)
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
      category: p.bookingId ? 'BOOKING' : p.membershipId ? 'MEMBERSHIP' : p.enrollmentId ? 'CLASS' : 'TOURNAMENT',
      bookingId: p.bookingId, kind: p.kind, amount: Number(p.amount), receivedAt: p.receivedAt,
      courtId: p.booking?.courtId ?? null, sportId: p.booking?.sportId ?? null,
      sportName: p.booking ? p.booking.sportRef?.name ?? p.booking.sport : null, source: p.booking?.source ?? null,
    })),
    netPaidByBooking: netPaid,
    courts: cfg.courts.map((c) => ({ ...c, name: c.label })),
    hours: cfg.hours,
  })
}

// GET /api/dashboard?venueId&range=today|week|month|custom&from&to
// Owners and managers only (reports:view). Employees don't see the dashboard.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'reports', 'view')
  if (ctx instanceof Response) return ctx

  try {
    const venueId = ctx.access.venueId
    const cfg = await loadVenueConfig(prisma, venueId)
    const today = todayIn(cfg.timezone)
    const r = resolveRange(sp, today)
    if (!r.ok) return jsonError(400, r.error)
    const { key: range, from, to } = r

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
        take: 8,
      }),
      prisma.booking.findMany({ where: { venueId }, select: bookingSelect, orderBy: { createdAt: 'desc' }, take: 6 }),
      // Today's remaining bookings per court (for "Courts right now")
      prisma.booking.findMany({
        where: { venueId, status: { not: 'CANCELLED' }, endTime: { gt: now }, startTime: { lt: localRangeToUtc(today, today, cfg.timezone).end } },
        select: { courtId: true, customer: true, startTime: true, endTime: true },
        orderBy: { startTime: 'asc' },
      }),
    ])
    const t = todayMetrics ?? current

    // Kept for custom roles that grant reports:view; always true for owners/managers.
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
      courtsInUseNow: new Set(liveNow.filter((b) => b.startTime <= now).map((b) => b.courtId)).size,
      activeCourts: cfg.courts.filter((c) => c.isActive).length,
      // Per court: who is on it now, and the next booking later today. Customer names only.
      courtsNow: cfg.courts.filter((c) => c.isActive).map((c) => {
        const mine = liveNow.filter((b) => b.courtId === c.id)
        const cur = mine.find((b) => b.startTime <= now)
        const next = mine.find((b) => b.startTime > now)
        const mins = (d: Date) => localMinutesOf(d, cfg.timezone)
        return {
          courtId: c.id,
          name: c.label,
          current: cur ? { customer: cur.customer, endMin: mins(cur.endTime) || 1440 } : null,
          next: next ? { customer: next.customer, startMin: mins(next.startTime) } : null,
        }
      }),
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
