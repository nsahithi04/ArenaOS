import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { payEnrollment } from '@/lib/club/service'
import { validateClubPayment } from '@/lib/club/validation'

// POST /api/enrollments/:id/payments — record a class fee payment (bookings:edit)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Enrolment not found')
  const e = await prisma.enrollment.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(e?.venueId, 'bookings', 'edit', 'Enrolment not found')
  if (ctx instanceof Response) return ctx
  try {
    const p = await payEnrollment(prisma, ctx.access.venueId, ctx.userId, id, validateClubPayment(await readJson(req)))
    return NextResponse.json({ id: p.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'enrollment payment POST')
  }
}
