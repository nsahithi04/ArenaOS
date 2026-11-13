import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, readJson } from '@/lib/booking/route-helpers'
import { requireSelfMember } from '@/lib/staff/me'
import { clockIn, clockOut } from '@/lib/staff/service'

// POST /api/me/clock { action: 'in' | 'out', note? } — clock myself in or out
export async function POST(req: Request) {
  const me = await requireSelfMember()
  if (me instanceof Response) return me
  try {
    const b = (await readJson(req)) as { action?: string; note?: unknown }
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim().slice(0, 300) : null
    if (b.action === 'in') return NextResponse.json(await clockIn(prisma, me.venueId, me.userId, note), { status: 201 })
    if (b.action === 'out') return NextResponse.json(await clockOut(prisma, me.venueId, me.userId))
    return jsonError(400, "action must be 'in' or 'out'")
  } catch (err) {
    return handleError(err, 'clock POST')
  }
}
