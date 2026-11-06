// Pure availability rules. The authoritative check runs server-side inside a
// locked transaction (lib/booking/service.ts) and is backed by the PostgreSQL
// exclusion constraint "Booking_no_overlap".

import { dayNameOf, parseClock, parseCloseClock } from './time'

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. Touching intervals do not overlap. */
export function overlaps(aStart: Date | number, aEnd: Date | number, bStart: Date | number, bEnd: Date | number): boolean {
  return +aStart < +bEnd && +bStart < +aEnd
}

/** Statuses that hold a court slot. Cancelled bookings never block availability. */
export const BLOCKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED'] as const

export function isBlockingStatus(status: string): boolean {
  return (BLOCKING_STATUSES as readonly string[]).includes(status)
}

export type HoursRow = { sportId: string | null; day: string; openTime: string; closeTime: string; isClosed: boolean }

export type HoursCheck =
  | { ok: true; open: number; close: number }
  | { ok: true; open: null; close: null; reason: 'no-hours-configured' }
  | { ok: false; reason: 'closed' | 'outside-hours'; open?: number; close?: number }

/**
 * Check a local [startMin, endMin) window against the operating hours of a sport
 * on that day. Hours with sportId = null apply venue-wide. If no hours are
 * configured at all, the slot is allowed (nothing to enforce).
 */
export function checkOperatingHours(hours: HoursRow[], sportId: string | null, localDate: string, startMin: number, endMin: number): HoursCheck {
  const day = dayNameOf(localDate).toUpperCase()
  const forDay = hours.filter((h) => h.day === day)
  const specific = forDay.filter((h) => sportId && h.sportId === sportId)
  const rows = specific.length ? specific : forDay.filter((h) => h.sportId === null)
  if (!rows.length) return { ok: true, open: null, close: null, reason: 'no-hours-configured' }

  const openRows = rows.filter((r) => !r.isClosed)
  if (!openRows.length) return { ok: false, reason: 'closed' }

  for (const r of openRows) {
    const open = parseClock(r.openTime)
    const close = parseCloseClock(r.closeTime)
    if (open == null || close == null) continue
    if (startMin >= open && endMin <= close) return { ok: true, open, close }
  }
  const first = openRows[0]
  return {
    ok: false,
    reason: 'outside-hours',
    open: parseClock(first.openTime) ?? undefined,
    close: parseCloseClock(first.closeTime) ?? undefined,
  }
}

/** Opening window used for occupancy and calendar shading. Falls back to venue-wide rows, then null. */
export function openWindow(hours: HoursRow[], sportId: string | null, localDate: string): { open: number; close: number } | null {
  const day = dayNameOf(localDate).toUpperCase()
  const forDay = hours.filter((h) => h.day === day)
  const specific = forDay.filter((h) => sportId && h.sportId === sportId)
  const rows = (specific.length ? specific : forDay.filter((h) => h.sportId === null)).filter((r) => !r.isClosed)
  let open = Infinity
  let close = -Infinity
  for (const r of rows) {
    const o = parseClock(r.openTime)
    const c = parseCloseClock(r.closeTime)
    if (o == null || c == null) continue
    open = Math.min(open, o)
    close = Math.max(close, c)
  }
  if (!Number.isFinite(open)) {
    // Explicitly closed vs. not configured
    const anyRows = (specific.length ? specific : forDay.filter((h) => h.sportId === null)).length > 0
    return anyRows ? { open: 0, close: 0 } : null
  }
  return { open, close }
}
