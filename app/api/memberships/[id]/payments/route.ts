import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { payMembership } from '@/lib/club/service'
import { validateClubPayment } from '@/lib/club/validation'

// POST /api/memberships/:id/payments — record money received toward a membership (bookings:edit)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Membership not found')
  const m = await prisma.membership.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(m?.venueId, 'bookings', 'edit', 'Membership not found')
  if (ctx instanceof Response) return ctx
  try {
    const r = await payMembership(prisma, ctx.access.venueId, ctx.userId, id, validateClubPayment(await readJson(req)))
    return NextResponse.json(r, { status: 201 })
  } catch (err) {
    return handleError(err, 'membership payment POST')
  }
}
