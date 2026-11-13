import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { deleteShift, updateShift } from '@/lib/staff/service'
import { validateShift } from '@/lib/staff/validation'
import { actorOf } from '@/lib/staff/routes'

type Params = { params: Promise<{ id: string }> }
async function lookup(id: string) {
  if (!isId(id)) return jsonError(404, 'Shift not found')
  const s = await prisma.shift.findUnique({ where: { id }, select: { venueId: true } })
  return requireEntityVenue(s?.venueId, 'team', 'edit', 'Shift not found')
}

// PATCH /api/staff/shifts/:id — edit (becomes a draft again until published)
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id)
  if (ctx instanceof Response) return ctx
  try {
    await updateShift(prisma, ctx.access.venueId, actorOf(ctx), id, validateShift(await readJson(req), true))
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'shift PATCH')
  }
}

// DELETE /api/staff/shifts/:id — remove (a published shift notifies the person straight away)
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id)
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await deleteShift(prisma, ctx.access.venueId, actorOf(ctx), id))
  } catch (err) {
    return handleError(err, 'shift DELETE')
  }
}
