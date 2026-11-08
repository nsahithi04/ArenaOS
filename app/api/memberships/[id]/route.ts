import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { cancelMembership } from '@/lib/club/service'

// PATCH /api/memberships/:id { action: 'cancel' } — cancel a membership (billing:edit → owners and managers).
// Future member bookings stay; staff can cancel those separately.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Membership not found')
  const m = await prisma.membership.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(m?.venueId, 'billing', 'edit', 'Membership not found')
  if (ctx instanceof Response) return ctx
  try {
    const { action } = (await readJson(req)) as { action?: string }
    if (action !== 'cancel') return jsonError(400, "action must be 'cancel'")
    await cancelMembership(prisma, ctx.access.venueId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'membership PATCH')
  }
}
