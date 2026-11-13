import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { updatePay } from '@/lib/staff/service'
import { validatePay } from '@/lib/staff/validation'
import { actorOf } from '@/lib/staff/routes'

// PATCH /api/staff/members/:id/pay { payType, payRate, position? } — owner, or managers for employees
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Team member not found')
  const m = await prisma.venueMember.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(m?.venueId, 'team', 'view', 'Team member not found')
  if (ctx instanceof Response) return ctx
  try {
    await updatePay(prisma, ctx.access.venueId, actorOf(ctx), id, validatePay(await readJson(req)))
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'pay PATCH')
  }
}
