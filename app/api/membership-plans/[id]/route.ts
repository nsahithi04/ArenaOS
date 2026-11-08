import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { updatePlan } from '@/lib/club/service'
import { validatePlan } from '@/lib/club/validation'

// PATCH /api/membership-plans/:id — edit a plan or retire it (isActive=false). Existing memberships keep their terms.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Plan not found')
  const plan = await prisma.membershipPlan.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(plan?.venueId, 'venue', 'edit', 'Plan not found')
  if (ctx instanceof Response) return ctx
  try {
    await updatePlan(prisma, ctx.access.venueId, id, validatePlan(await readJson(req), true))
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'plan PATCH')
  }
}
