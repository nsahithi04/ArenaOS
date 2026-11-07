import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission, lockActorOf } from '@/lib/booking/access'
import { requireBookingAccess } from '@/lib/booking/booking-lookup'
import { bookingSelect, toBookingDTO } from '@/lib/booking/queries'
import { handleError, jsonError, readJson } from '@/lib/booking/route-helpers'
import { updateBooking } from '@/lib/booking/service'
import { validateUpdateBooking } from '@/lib/booking/validation'

type Params = { params: Promise<{ id: string }> }

async function detail(id: string, includeContact: boolean) {
  const b = await prisma.booking.findUnique({
    where: { id },
    select: {
      ...bookingSelect,
      venue: { select: { timezone: true, currency: true } },
      createdBy: { select: { name: true } },
      payments: {
        select: { id: true, kind: true, method: true, amount: true, receivedAt: true, note: true, recordedBy: { select: { name: true } } },
        orderBy: { receivedAt: 'asc' },
      },
    },
  })
  if (!b) return null
  return {
    ...toBookingDTO(b, b.venue.timezone, { includeContact }),
    currency: b.venue.currency,
    timezone: b.venue.timezone,
    createdByName: b.createdBy?.name ?? null,
    paymentHistory: b.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      method: p.method,
      amount: Number(p.amount),
      receivedAt: p.receivedAt.toISOString(),
      note: p.note,
      recordedByName: p.recordedBy?.name ?? null,
    })),
  }
}

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireBookingAccess(id, 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const d = await detail(id, hasPermission(ctx.access, 'bookings', 'edit'))
    return d ? NextResponse.json(d) : jsonError(404, 'Booking not found')
  } catch (err) {
    return handleError(err, 'booking GET')
  }
}

// PATCH /api/bookings/:id — edit details, reschedule (courtId/date/start/end),
// change status (CONFIRMED, CHECKED_IN, COMPLETED, CANCELLED + cancelReason, reinstate).
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await requireBookingAccess(id, 'bookings', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    const input = validateUpdateBooking(await readJson(req))
    await updateBooking(prisma, ctx.access.venueId, ctx.userId, id, input, lockActorOf(ctx.access))
    return NextResponse.json(await detail(id, true))
  } catch (err) {
    return handleError(err, 'booking PATCH')
  }
}
