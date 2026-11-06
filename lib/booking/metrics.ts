// Dashboard metrics, computed in the venue's timezone.
//
// Definitions (shown in the UI too):
//   Gross booked  = booked price of non-cancelled bookings whose play date is in range.
//   Collected     = payments received in range − refunds issued in range (from Payment rows).
//   Outstanding   = for non-cancelled bookings in range: booked price − net paid (any date), when > 0.
//   Occupancy     = booked minutes of non-cancelled bookings ÷ open minutes of active courts.

import { openWindow, type HoursRow } from './availability'
import { addDays, diffDays, localDateOf } from './time'
import { ONLINE_SOURCES, OFFLINE_SOURCES } from './validation'

export type MetricBooking = {
  id: string
  courtId: string
  sportId: string | null
  sportName: string | null
  source: string
  status: string
  startTime: Date
  endTime: Date
  amount: number
}

export type MetricPayment = {
  bookingId: string
  kind: 'PAYMENT' | 'REFUND'
  amount: number
  receivedAt: Date
  courtId: string
  sportId: string | null
  sportName: string | null
  source: string
}

export type MetricCourt = { id: string; name: string; sportId: string | null; isActive: boolean }

const r2 = (n: number) => Math.round(n * 100) / 100

export function computeMetrics(opts: {
  tz: string
  from: string
  to: string
  bookings: MetricBooking[]
  payments: MetricPayment[]
  /** Net paid (payments − refunds, any date) per booking id. */
  netPaidByBooking: Map<string, number>
  courts: MetricCourt[]
  hours: HoursRow[]
}) {
  const { tz, from, to, bookings, payments, netPaidByBooking, courts, hours } = opts
  const days: string[] = []
  for (let d = from; diffDays(d, to) >= 0; d = addDays(d, 1)) days.push(d)

  const active = bookings.filter((b) => b.status !== 'CANCELLED')
  const cancelled = bookings.filter((b) => b.status === 'CANCELLED')

  const gross = r2(active.reduce((s, b) => s + b.amount, 0))
  let paymentsIn = 0
  let refundsOut = 0
  for (const p of payments) {
    if (p.kind === 'PAYMENT') paymentsIn += p.amount
    else refundsOut += p.amount
  }

  let outstanding = 0
  let pendingCount = 0
  for (const b of active) {
    const bal = r2(b.amount - (netPaidByBooking.get(b.id) ?? 0))
    if (bal > 0) {
      outstanding += bal
      pendingCount++
    }
  }

  // Occupancy
  const activeCourts = courts.filter((c) => c.isActive)
  let openMinutes = 0
  let hoursConfigured = false
  const openByCourt = new Map<string, number>()
  for (const c of activeCourts) {
    let mins = 0
    for (const d of days) {
      const w = openWindow(hours, c.sportId, d)
      if (w) {
        hoursConfigured = true
        mins += Math.max(0, w.close - w.open)
      }
    }
    openByCourt.set(c.id, mins)
    openMinutes += mins
  }
  const bookedByCourt = new Map<string, number>()
  let bookedMinutes = 0
  for (const b of active) {
    const m = (b.endTime.getTime() - b.startTime.getTime()) / 60000
    bookedMinutes += m
    bookedByCourt.set(b.courtId, (bookedByCourt.get(b.courtId) ?? 0) + m)
  }
  const occupancy = hoursConfigured && openMinutes > 0 ? Math.min(1, bookedMinutes / openMinutes) : null

  // Trend by local day
  const trend = new Map(days.map((d) => [d, { date: d, gross: 0, collected: 0, bookings: 0, cancelled: 0, online: 0, offline: 0 }]))
  for (const b of bookings) {
    const t = trend.get(localDateOf(b.startTime, tz))
    if (!t) continue
    if (b.status === 'CANCELLED') {
      t.cancelled++
      continue
    }
    t.gross += b.amount
    t.bookings++
    if (ONLINE_SOURCES.includes(b.source as never)) t.online++
    else t.offline++
  }
  for (const p of payments) {
    const t = trend.get(localDateOf(p.receivedAt, tz))
    if (t) t.collected += p.kind === 'PAYMENT' ? p.amount : -p.amount
  }

  // Breakdowns
  type Agg = { key: string; name: string; gross: number; collected: number; bookings: number }
  const bump = (m: Map<string, Agg>, key: string, name: string) => {
    let a = m.get(key)
    if (!a) m.set(key, (a = { key, name, gross: 0, collected: 0, bookings: 0 }))
    return a
  }
  const bySport = new Map<string, Agg>()
  const byCourt = new Map<string, Agg>()
  const bySource = new Map<string, Agg>()
  const courtName = new Map(courts.map((c) => [c.id, c.name]))
  for (const b of active) {
    const s = bump(bySport, b.sportId ?? `name:${b.sportName ?? 'Unspecified'}`, b.sportName ?? 'Unspecified')
    s.gross += b.amount
    s.bookings++
    const c = bump(byCourt, b.courtId, courtName.get(b.courtId) ?? 'Removed court')
    c.gross += b.amount
    c.bookings++
    const src = bump(bySource, b.source, b.source)
    src.gross += b.amount
    src.bookings++
  }
  for (const p of payments) {
    const sign = p.kind === 'PAYMENT' ? 1 : -1
    bump(bySport, p.sportId ?? `name:${p.sportName ?? 'Unspecified'}`, p.sportName ?? 'Unspecified').collected += sign * p.amount
    bump(byCourt, p.courtId, courtName.get(p.courtId) ?? 'Removed court').collected += sign * p.amount
    bump(bySource, p.source, p.source).collected += sign * p.amount
  }
  const finish = (m: Map<string, Agg>) =>
    [...m.values()].map((a) => ({ ...a, gross: r2(a.gross), collected: r2(a.collected) })).sort((x, y) => y.gross - x.gross)

  const channel = { online: { bookings: 0, gross: 0 }, offline: { bookings: 0, gross: 0 }, other: { bookings: 0, gross: 0 } }
  for (const b of active) {
    const k = ONLINE_SOURCES.includes(b.source as never) ? 'online' : OFFLINE_SOURCES.includes(b.source as never) ? 'offline' : 'other'
    channel[k].bookings++
    channel[k].gross += b.amount
  }
  for (const k of ['online', 'offline', 'other'] as const) channel[k].gross = r2(channel[k].gross)

  return {
    range: { from, to, days: days.length },
    gross,
    collected: r2(paymentsIn - refundsOut),
    paymentsReceived: r2(paymentsIn),
    refunds: r2(refundsOut),
    bookings: active.length,
    cancellations: { count: cancelled.length, value: r2(cancelled.reduce((s, b) => s + b.amount, 0)), rate: bookings.length ? cancelled.length / bookings.length : 0 },
    pending: { count: pendingCount, outstanding: r2(outstanding) },
    occupancy,
    bookedHours: r2(bookedMinutes / 60),
    openHours: r2(openMinutes / 60),
    trend: [...trend.values()].map((t) => ({ ...t, gross: r2(t.gross), collected: r2(t.collected) })),
    bySport: finish(bySport),
    byCourt: finish(byCourt).map((c) => ({
      ...c,
      occupancy: openByCourt.get(c.key) ? Math.min(1, (bookedByCourt.get(c.key) ?? 0) / openByCourt.get(c.key)!) : null,
    })),
    bySource: finish(bySource),
    channel,
  }
}

export type DashboardMetrics = ReturnType<typeof computeMetrics>
