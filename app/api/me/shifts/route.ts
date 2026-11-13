import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getVenueAccess } from '@/lib/booking/access'
import { handleError } from '@/lib/booking/route-helpers'
import { addDays, localDateOf, localMinutesOf, localRangeToUtc, startOfMonth, endOfMonth, todayIn } from '@/lib/booking/time'
import { requireSelfMember } from '@/lib/staff/me'
import { payrollReport } from '@/lib/staff/service'

// GET /api/me/shifts — my upcoming published shifts, clock status, recent time and pay this month
export async function GET() {
  const me = await requireSelfMember()
  if (me instanceof Response) return me
  try {
    const v = await prisma.venue.findUniqueOrThrow({ where: { id: me.venueId }, select: { name: true, timezone: true, currency: true } })
    const tz = v.timezone
    const today = todayIn(tz)
    const upcoming = await prisma.shift.findMany({
      where: { memberId: me.member.id, published: true, endTime: { gt: new Date() }, startTime: { lt: localRangeToUtc(today, addDays(today, 30), tz).end } },
      orderBy: { startTime: 'asc' },
    })
    const { start: recentStart } = localRangeToUtc(addDays(today, -14), today, tz)
    const entries = await prisma.timeEntry.findMany({ where: { memberId: me.member.id, clockIn: { gte: recentStart } }, orderBy: { clockIn: 'desc' } })
    const open = await prisma.timeEntry.findFirst({ where: { memberId: me.member.id, clockOut: null } })
    const access = await getVenueAccess(prisma, me.userId, me.venueId)
    const pay = await payrollReport(prisma, me.venueId, { userId: me.userId, access: access! }, startOfMonth(today), endOfMonth(today), { onlyMemberId: me.member.id })
    const now = Date.now()
    return NextResponse.json({
      venue: v.name, currency: v.currency, today, name: me.member.name, position: me.member.position,
      onClockSince: open?.clockIn.toISOString() ?? null,
      shifts: upcoming.map((s) => ({ id: s.id, date: s.date, startMin: localMinutesOf(s.startTime, tz), endMin: localDateOf(s.endTime, tz) !== s.date ? 1440 : localMinutesOf(s.endTime, tz), position: s.position, notes: s.notes })),
      entries: entries.map((e) => ({ id: e.id, date: localDateOf(e.clockIn, tz), inMin: localMinutesOf(e.clockIn, tz), outMin: e.clockOut ? localMinutesOf(e.clockOut, tz) : null, minutes: Math.round(((e.clockOut ? +e.clockOut : now) - +e.clockIn) / 60000), manual: e.manual })),
      month: pay.rows[0] ?? null,
      monthRange: { from: pay.from, to: pay.to },
    })
  } catch (err) {
    return handleError(err, 'me shifts GET')
  }
}
