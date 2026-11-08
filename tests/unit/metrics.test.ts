import { describe, expect, it } from 'vitest'
import { computeMetrics, type MetricBooking, type MetricPayment } from '@/lib/booking/metrics'
import { zonedToUtc } from '@/lib/booking/time'

const TZ = 'America/Phoenix'
const at = (date: string, h: number) => zonedToUtc(date, h * 60, TZ)
const bk = (o: Partial<MetricBooking> & { id: string }): MetricBooking => ({
  courtId: 'c1', sportId: 's1', sportName: 'Pickleball', source: 'PHONE', status: 'CONFIRMED',
  startTime: at('2026-11-05', 10), endTime: at('2026-11-05', 11), amount: 20, ...o,
})
const pay = (o: Partial<MetricPayment> & { bookingId: string | null; amount: number }): MetricPayment => ({
  category: 'BOOKING',
  kind: 'PAYMENT', receivedAt: at('2026-11-05', 12), courtId: 'c1', sportId: 's1', sportName: 'Pickleball', source: 'PHONE', ...o,
})

describe('computeMetrics', () => {
  const bookings = [
    bk({ id: 'a', amount: 20 }), // paid in full
    bk({ id: 'b', amount: 30, source: 'PLAYO', courtId: 'c2', startTime: at('2026-11-05', 17), endTime: at('2026-11-05', 18) }), // part-paid
    bk({ id: 'c', amount: 25, status: 'CANCELLED', source: 'WALK_IN' }), // cancelled + refunded
    bk({ id: 'd', amount: 40, source: 'WALK_IN', sportId: 's2', sportName: 'Badminton', startTime: at('2026-11-06', 20), endTime: at('2026-11-06', 22) }), // unpaid
  ]
  const payments = [
    pay({ bookingId: 'a', amount: 20 }),
    pay({ bookingId: 'b', amount: 10, source: 'PLAYO', courtId: 'c2' }),
    pay({ bookingId: 'c', amount: 25, source: 'WALK_IN' }),
    pay({ bookingId: 'c', amount: 25, kind: 'REFUND', source: 'WALK_IN', receivedAt: at('2026-11-06', 9) }),
  ]
  const netPaid = new Map([['a', 20], ['b', 10], ['c', 0]])
  const hours = ['THURSDAY', 'FRIDAY'].map((day) => ({ sportId: null, day, openTime: '8:00 AM', closeTime: '10:00 PM', isClosed: false }))
  const m = computeMetrics({
    tz: TZ, from: '2026-11-05', to: '2026-11-06', bookings, payments, netPaidByBooking: netPaid,
    courts: [{ id: 'c1', name: 'Court 1', sportId: 's1', isActive: true }, { id: 'c2', name: 'Court 2', sportId: 's1', isActive: true }],
    hours,
  })

  it('separates gross booked from collected', () => {
    expect(m.gross).toBe(90) // 20 + 30 + 40, cancelled excluded
    expect(m.paymentsReceived).toBe(55) // 20 + 10 + 25
    expect(m.refunds).toBe(25)
    expect(m.collected).toBe(30)
  })

  it('counts pending payments and cancellations', () => {
    expect(m.bookings).toBe(3)
    expect(m.pending).toEqual({ count: 2, outstanding: 60 }) // b: 20 due, d: 40 due
    expect(m.cancellations).toMatchObject({ count: 1, value: 25 })
    expect(m.cancellations.rate).toBeCloseTo(0.25)
  })

  it('computes occupancy from operating hours', () => {
    // 2 courts × 2 days × 14h open = 56h; booked 1 + 1 + 2 = 4h
    expect(m.openHours).toBe(56)
    expect(m.bookedHours).toBe(4)
    expect(m.occupancy).toBeCloseTo(4 / 56)
  })

  it('buckets the trend by venue-local day', () => {
    // Booking d starts 20:00 Phoenix on Nov 6 = 03:00 UTC Nov 7, but belongs to Nov 6 locally.
    expect(m.trend).toEqual([
      expect.objectContaining({ date: '2026-11-05', gross: 50, collected: 55, bookings: 2, cancelled: 1, online: 1, offline: 1 }),
      expect.objectContaining({ date: '2026-11-06', gross: 40, collected: -25, bookings: 1, online: 0, offline: 1 }),
    ])
  })

  it('breaks down by sport, court and channel', () => {
    expect(m.bySport.map((s) => [s.name, s.gross, s.collected])).toEqual([
      ['Pickleball', 50, 30],
      ['Badminton', 40, 0],
    ])
    expect(m.byCourt.find((c) => c.key === 'c2')).toMatchObject({ gross: 30, collected: 10, bookings: 1 })
    expect(m.channel).toEqual({ online: { bookings: 1, gross: 30 }, offline: { bookings: 2, gross: 60 }, other: { bookings: 0, gross: 0 } })
  })

  it('splits collected revenue by type and keeps court breakdowns to court bookings', () => {
    const r = computeMetrics({
      tz: TZ, from: '2026-11-05', to: '2026-11-05', bookings: [], netPaidByBooking: new Map(), hours: [],
      courts: [{ id: 'c1', name: 'Court 1', sportId: 's1', isActive: true }],
      payments: [
        pay({ bookingId: 'a', amount: 20 }),
        pay({ category: 'MEMBERSHIP', bookingId: null, courtId: null, sportId: null, sportName: null, source: null, amount: 99 }),
        pay({ category: 'CLASS', bookingId: null, courtId: null, sportId: null, sportName: null, source: null, amount: 50 }),
        pay({ category: 'CLASS', bookingId: null, courtId: null, sportId: null, sportName: null, source: null, amount: 10, kind: 'REFUND' }),
      ],
    })
    expect(r.collected).toBe(159)
    expect(r.byType.map((t) => [t.key, t.collected])).toEqual([['BOOKING', 20], ['MEMBERSHIP', 99], ['CLASS', 40]])
    expect(r.byCourt.find((c) => c.key === 'c1')?.collected).toBe(20)
    expect(r.bySport.reduce((s, x) => s + (x.collected ?? 0), 0)).toBe(20)
  })

  it('returns null occupancy when no hours are configured', () => {
    const r = computeMetrics({ tz: TZ, from: '2026-11-05', to: '2026-11-05', bookings: [], payments: [], netPaidByBooking: new Map(), courts: [{ id: 'c1', name: 'C', sportId: null, isActive: true }], hours: [] })
    expect(r.occupancy).toBeNull()
    expect(r.gross).toBe(0)
  })
})
