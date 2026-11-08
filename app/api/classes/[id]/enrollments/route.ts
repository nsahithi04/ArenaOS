import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { enroll } from '@/lib/club/service'
import { validateEnroll } from '@/lib/club/validation'

// POST /api/classes/:id/enrollments — enrol a student, optionally with a payment (bookings:edit)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isId(id)) return jsonError(404, 'Class not found')
  const c = await prisma.class.findUnique({ where: { id }, select: { venueId: true } })
  const ctx = await requireEntityVenue(c?.venueId, 'bookings', 'edit', 'Class not found')
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await enroll(prisma, ctx.access.venueId, ctx.userId, id, validateEnroll(await readJson(req))), { status: 201 })
  } catch (err) {
    return handleError(err, 'enroll POST')
  }
}
