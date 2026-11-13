import { prisma } from '@/lib/db'
import { isLocalDate, todayIn, addDays, startOfWeek, startOfMonth, endOfMonth } from '@/lib/booking/time'
import { jsonError } from '@/lib/booking/route-helpers'
import type { Ctx } from '@/lib/booking/route-helpers'
import type { StaffActor } from './service'

export const actorOf = (ctx: Ctx): StaffActor => ({ userId: ctx.userId, access: ctx.access })

export async function venueToday(venueId: string) {
  const v = await prisma.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true, currency: true, name: true } })
  return { ...v, today: todayIn(v.timezone) }
}

/** from/to query params, defaulting to the current week (Mon–Sun). Max 62 days. */
export function weekRange(sp: URLSearchParams, today: string): { from: string; to: string } | Response {
  const from = sp.get('from'), to = sp.get('to')
  if (isLocalDate(from) && isLocalDate(to)) {
    if (to < from) return jsonError(400, '"to" must be on or after "from"')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 62) return jsonError(400, 'Range can be at most 62 days')
    return { from, to }
  }
  const s = startOfWeek(today)
  return { from: s, to: addDays(s, 6) }
}

/** range=month|lastmonth|week|custom (+from/to). Defaults to this month. */
export function payRange(sp: URLSearchParams, today: string): { from: string; to: string } | Response {
  const r = sp.get('range') ?? 'month'
  if (r === 'week') { const s = startOfWeek(today); return { from: s, to: addDays(s, 6) } }
  if (r === 'lastmonth') { const last = addDays(startOfMonth(today), -1); return { from: startOfMonth(last), to: endOfMonth(last) } }
  if (r === 'custom') {
    const from = sp.get('from'), to = sp.get('to')
    if (!isLocalDate(from) || !isLocalDate(to) || to < from) return jsonError(400, 'Custom range needs valid from and to dates')
    if ((Date.parse(to) - Date.parse(from)) / 86400000 > 366) return jsonError(400, 'Range can be at most a year')
    return { from, to }
  }
  return { from: startOfMonth(today), to: endOfMonth(today) }
}
