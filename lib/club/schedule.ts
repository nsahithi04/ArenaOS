// Pure date helpers for memberships and recurring classes (venue-local 'YYYY-MM-DD' dates).

import { addDays, dayNameOf, diffDays } from '@/lib/booking/time'

export const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
export type Weekday = (typeof WEEKDAYS)[number]

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate() // m is 1-based here
}

/**
 * Last day (inclusive) of a membership that starts on `start` and lasts `months`.
 * Jan 15 + 1 month → Feb 14.  Jan 31 + 1 month → Feb 28 (end of the shorter month).
 */
export function membershipEndDate(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const total = m - 1 + months
  const ty = y + Math.floor(total / 12)
  const tm = (total % 12) + 1
  const dim = daysInMonth(ty, tm)
  if (d > dim) return `${ty}-${String(tm).padStart(2, '0')}-${String(dim).padStart(2, '0')}`
  return addDays(`${ty}-${String(tm).padStart(2, '0')}-${String(d).padStart(2, '0')}`, -1)
}

export function isMembershipActiveOn(m: { status: string; startDate: string; endDate: string }, date: string): boolean {
  return m.status === 'ACTIVE' && date >= m.startDate && date <= m.endDate
}

export function membershipState(m: { status: string; startDate: string; endDate: string }, today: string): 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'CANCELLED' {
  if (m.status === 'CANCELLED') return 'CANCELLED'
  if (today < m.startDate) return 'UPCOMING'
  if (today > m.endDate) return 'EXPIRED'
  return 'ACTIVE'
}

/** All dates in [from, to] (inclusive) that fall on one of `days`. */
export function sessionDates(from: string, to: string, days: readonly string[]): string[] {
  const want = new Set(days)
  const out: string[] = []
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) {
    const d = addDays(from, i)
    if (want.has(dayNameOf(d).toUpperCase())) out.push(d)
  }
  return out
}

export function formatDays(days: readonly string[]): string {
  const order = WEEKDAYS.filter((d) => days.includes(d))
  return order.map((d) => d.charAt(0) + d.slice(1, 3).toLowerCase()).join(', ')
}
