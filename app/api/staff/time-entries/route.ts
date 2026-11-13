import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { localDateOf, localMinutesOf, localRangeToUtc } from '@/lib/booking/time'
import { canManageMember, saveTimeEntry } from '@/lib/staff/service'
import { validateTimeEntry } from '@/lib/staff/validation'
import { actorOf, venueToday, weekRange } from '@/lib/staff/routes'

// GET /api/staff/time-entries?venueId&from&to&memberId — time sheets (team:view)
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
    const memberId = sp.get('memberId')
    const entries = await prisma.timeEntry.findMany({
      where: { venueId, clockIn: { gte: start, lt: end }, ...(memberId && /^[a-zA-Z0-9_-]{1,64}$/.test(memberId) && { memberId }) },
      include: { member: { include: { role: { select: { name: true, permissions: true, preset: true } } } }, shift: { select: { startTime: true, endTime: true } } },
      orderBy: { clockIn: 'desc' },
      take: 1000,
    })
    const actor = actorOf(ctx)
    const now = Date.now()
    return NextResponse.json({
      ...r, today: v.today,
      items: entries.map((e) => ({
        id: e.id, memberId: e.memberId, name: e.member.name, date: localDateOf(e.clockIn, v.timezone),
        inMin: localMinutesOf(e.clockIn, v.timezone), outMin: e.clockOut ? localMinutesOf(e.clockOut, v.timezone) : null,
        outDate: e.clockOut ? localDateOf(e.clockOut, v.timezone) : null,
        minutes: Math.round(((e.clockOut ? +e.clockOut : now) - +e.clockIn) / 60000), open: !e.clockOut, manual: e.manual, note: e.note,
        shift: e.shift ? { startMin: localMinutesOf(e.shift.startTime, v.timezone), endMin: localMinutesOf(e.shift.endTime, v.timezone) || 1440 } : null,
        canEdit: canManageMember(actor, e.member),
      })),
    })
  } catch (err) {
    return handleError(err, 'time entries GET')
  }
}

// POST /api/staff/time-entries — add a time entry for someone (team:edit)
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const input = validateTimeEntry(body)
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'team', 'edit')
    if (ctx instanceof Response) return ctx
    const e = await saveTimeEntry(prisma, ctx.access.venueId, actorOf(ctx), input)
    return NextResponse.json({ id: e.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'time entry POST')
  }
}
