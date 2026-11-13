import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { localDateOf, localMinutesOf, localRangeToUtc } from '@/lib/booking/time'
import { canManageMember } from '@/lib/staff/service'
import { actorOf, venueToday, weekRange } from '@/lib/staff/routes'

// GET /api/staff?venueId&from&to — team members and their shifts (drafts included) for the schedule (team:view)
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'team', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venueId = ctx.access.venueId
    const v = await venueToday(venueId)
    const r = weekRange(sp, v.today)
    if (r instanceof Response) return r
    const { start, end } = localRangeToUtc(r.from, r.to, v.timezone)
    const actor = actorOf(ctx)
    const members = await prisma.venueMember.findMany({
      where: { venueId, status: { in: ['active', 'invited'] } },
      include: { role: { select: { name: true, permissions: true, preset: true, color: true } } },
      orderBy: { name: 'asc' },
    })
    const shifts = await prisma.shift.findMany({ where: { venueId, startTime: { gte: start, lt: end } }, orderBy: { startTime: 'asc' } })
    const open = await prisma.timeEntry.findMany({ where: { venueId, clockOut: null }, select: { memberId: true, clockIn: true } })
    return NextResponse.json({
      ...r, today: v.today, timezone: v.timezone,
      members: members.map((m) => ({
        id: m.id, name: m.name, role: m.role?.name ?? null, roleColor: m.role?.color ?? null, position: m.position, status: m.status,
        isYou: m.userId === ctx.userId, canEdit: canManageMember(actor, m), hasAccount: !!m.userId,
        onClockSince: open.find((o) => o.memberId === m.id)?.clockIn.toISOString() ?? null,
      })),
      shifts: shifts.map((s) => ({
        id: s.id, memberId: s.memberId, date: s.date, startMin: localMinutesOf(s.startTime, v.timezone),
        endMin: localDateOf(s.endTime, v.timezone) !== s.date ? 1440 : localMinutesOf(s.endTime, v.timezone),
        position: s.position, notes: s.notes, published: s.published,
      })),
      drafts: shifts.filter((s) => !s.published).length,
    })
  } catch (err) {
    return handleError(err, 'staff GET')
  }
}
