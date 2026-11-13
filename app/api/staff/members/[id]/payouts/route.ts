import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { localDateOf } from '@/lib/booking/time'
import { canSeePay, recordPayout } from '@/lib/staff/service'
import { validatePayout } from '@/lib/staff/validation'
import { actorOf } from '@/lib/staff/routes'

type Params = { params: Promise<{ id: string }> }

// GET /api/staff/members/:id/payouts — payout history (visible to whoever can see this person's pay)
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Team member not found')
  const m = await prisma.venueMember.findUnique({ where: { id }, include: { role: { select: { name: true, permissions: true, preset: true } }, venue: { select: { timezone: true } } } })
  const ctx = await requireEntityVenue(m?.venueId, 'team', 'view', 'Team member not found')
  if (ctx instanceof Response) return ctx
  if (!canSeePay(actorOf(ctx), m!)) return jsonError(404, 'Team member not found')
  const payouts = await prisma.payrollPayout.findMany({ where: { memberId: id }, orderBy: { paidAt: 'desc' }, take: 100 })
  return NextResponse.json(payouts.map((p) => ({ id: p.id, periodStart: p.periodStart, periodEnd: p.periodEnd, amount: Number(p.amount), method: p.method, note: p.note, paidOn: localDateOf(p.paidAt, m!.venue.timezone) })))
}

// POST /api/staff/members/:id/payouts — record money paid to this person (owner, or managers for employees)
export async function POST(req: Request, { params }: Params) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Team member not found')
  const m = await prisma.venueMember.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(m?.venueId, 'team', 'view', 'Team member not found')
  if (ctx instanceof Response) return ctx
  try {
    const p = await recordPayout(prisma, ctx.access.venueId, actorOf(ctx), id, validatePayout(await readJson(req)))
    return NextResponse.json({ id: p.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'payout POST')
  }
}
