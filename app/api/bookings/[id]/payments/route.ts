import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission, lockActorOf } from '@/lib/booking/access'
import { requireBookingAccess } from '@/lib/booking/booking-lookup'
import { handleError, jsonError, readJson } from '@/lib/booking/route-helpers'
import { recordPayment } from '@/lib/booking/service'
import { validatePayment } from '@/lib/booking/validation'

// POST /api/bookings/:id/payments — record money received (PAYMENT) or returned (REFUND).
// Payments need bookings:edit; refunds additionally need billing:edit.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireBookingAccess(id, 'bookings', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    const input = validatePayment(await readJson(req))
    if (input.kind === 'REFUND' && !hasPermission(ctx.access, 'billing', 'edit')) {
      return jsonError(403, "You don't have permission to issue refunds")
    }
    const result = await recordPayment(prisma, ctx.access.venueId, ctx.userId, id, input, lockActorOf(ctx.access))
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return handleError(err, 'booking payments POST')
  }
}
