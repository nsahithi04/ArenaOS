import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { jsonError, readJson } from '@/lib/booking/route-helpers'

// POST /api/notifications/read { ids?: string[], all?: true } — mark my notifications as read
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return jsonError(401, 'Unauthorized')
  const b = (await readJson(req)) as { ids?: unknown; all?: unknown }
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string').slice(0, 100) : []
  if (b.all !== true && !ids.length) return jsonError(400, 'Give ids or all: true')
  const r = await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null, ...(b.all !== true && { id: { in: ids } }) },
    data: { readAt: new Date() },
  })
  return NextResponse.json({ marked: r.count })
}
