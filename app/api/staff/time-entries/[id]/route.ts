import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, isId, jsonError, readJson, requireEntityVenue } from '@/lib/booking/route-helpers'
import { deleteTimeEntry, saveTimeEntry } from '@/lib/staff/service'
import { validateTimeEntry } from '@/lib/staff/validation'
import { actorOf } from '@/lib/staff/routes'

type Params = { params: Promise<{ id: string }> }
async function lookup(id: string) {
  if (!isId(id)) return jsonError(404, 'Time entry not found')
  const e = await prisma.timeEntry.findUnique({ where: { id }, select: { venueId: true } })
  return requireEntityVenue(e?.venueId, 'team', 'edit', 'Time entry not found')
}

// PATCH /api/staff/time-entries/:id — correct a time entry (team:edit)
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id)
  if (ctx instanceof Response) return ctx
  try {
    await saveTimeEntry(prisma, ctx.access.venueId, actorOf(ctx), validateTimeEntry(await readJson(req)), id)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'time entry PATCH')
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params
  const ctx = await lookup(id)
  if (ctx instanceof Response) return ctx
  try {
    return NextResponse.json(await deleteTimeEntry(prisma, ctx.access.venueId, actorOf(ctx), id))
  } catch (err) {
    return handleError(err, 'time entry DELETE')
  }
}
