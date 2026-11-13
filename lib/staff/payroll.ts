// Pure payroll maths. Dates are venue-local 'YYYY-MM-DD' (inclusive ranges).
//
//   HOURLY  → pay = hours actually worked (from time entries) × hourly rate
//   MONTHLY → pay = monthly salary × (days of the period in each month ÷ days in that month),
//             so a full calendar month = exactly one salary and half a 30-day month = half.

import { addDays, diffDays } from '@/lib/booking/time'

const r2 = (n: number) => Math.round(n * 100) / 100

export type PayType = 'HOURLY' | 'MONTHLY'

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Monthly salary pro-rated over [from, to] by the share of each calendar month covered. */
export function salaryForPeriod(monthly: number, from: string, to: string): number {
  if (to < from) return 0
  let total = 0
  let cursor = from
  while (cursor <= to) {
    const [y, m] = cursor.split('-').map(Number)
    const dim = daysInMonth(y, m)
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(dim).padStart(2, '0')}`
    const segEnd = monthEnd < to ? monthEnd : to
    const days = diffDays(cursor, segEnd) + 1
    total += (monthly * days) / dim
    cursor = addDays(segEnd, 1)
  }
  return r2(total)
}

export type Interval = { start: Date; end: Date | null }

/** Minutes of the intervals inside [periodStart, periodEnd). Open intervals count up to `now`. */
export function minutesWithin(intervals: Interval[], periodStart: Date, periodEnd: Date, now: Date = new Date()): number {
  let ms = 0
  for (const i of intervals) {
    const s = Math.max(+i.start, +periodStart)
    const e = Math.min(+(i.end ?? now), +periodEnd)
    if (e > s) ms += e - s
  }
  return Math.round(ms / 60000)
}

export function grossPay(payType: PayType | null, rate: number | null, workedMinutes: number, from: string, to: string): number | null {
  if (!payType || rate == null) return null
  return payType === 'HOURLY' ? r2((workedMinutes / 60) * rate) : salaryForPeriod(rate, from, to)
}

export const hours = (minutes: number) => r2(minutes / 60)
