import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, requireVenue } from '@/lib/booking/route-helpers'

// DELETE /api/court-blocks/:id — remove a maintenance block (frees the slot).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return jsonError(404, 'Block not found')
  try {
    const block = await prisma.courtBlock.findUnique({ where: { id }, select: { venueId: true, classId: true } })
    if (!block) return jsonError(404, 'Block not found')
    const ctx = await requireVenue(block.venueId, 'bookings', 'edit')
    if (ctx instanceof Response) return ctx.status === 403 ? jsonError(404, 'Block not found') : ctx
    if (block.classId) return jsonError(409, 'This is a class session. Edit or cancel the class under Classes instead.')
    await prisma.courtBlock.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'court-blocks DELETE')
  }
}
