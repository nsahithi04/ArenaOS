// Dashboard date ranges, resolved in the venue's timezone.

import { addDays, diffDays, endOfMonth, isLocalDate, startOfMonth, startOfWeek } from './time'

export type RangeResult = { ok: true; key: string; from: string; to: string } | { ok: false; error: string }

/** range=today|week|month|custom (+from,to). Defaults to this week (Mon–Sun). */
export function resolveRange(sp: URLSearchParams, today: string): RangeResult {
  const key = sp.get('range') ?? 'week'
  if (key === 'today') return { ok: true, key, from: today, to: today }
  if (key === 'month') return { ok: true, key, from: startOfMonth(today), to: endOfMonth(today) }
  if (key === 'custom') {
    const f = sp.get('from')
    const t = sp.get('to')
    if (!isLocalDate(f) || !isLocalDate(t)) return { ok: false, error: 'Custom range needs from and to (YYYY-MM-DD)' }
    if (diffDays(f, t) < 0) return { ok: false, error: '"from" must be on or before "to"' }
    if (diffDays(f, t) > 366) return { ok: false, error: 'Custom range can be at most one year' }
    return { ok: true, key, from: f, to: t }
  }
  return { ok: true, key: 'week', from: startOfWeek(today), to: addDays(startOfWeek(today), 6) }
}
