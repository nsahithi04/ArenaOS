import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, requireEntityVenue } from '@/lib/booking/route-helpers'
import { withdraw } from '@/lib/club/service'

// DELETE /api/enrollments/:id — withdraw a student (bookings:edit). Their payments stay on record.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Enrolment not found')
  const e = await prisma.enrollment.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(e?.venueId, 'bookings', 'edit', 'Enrolment not found')
  if (ctx instanceof Response) return ctx
  try {
    await withdraw(prisma, ctx.access.venueId, id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'enrollment DELETE')
  }
}
