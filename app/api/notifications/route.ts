import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { jsonError } from '@/lib/booking/route-helpers'

// GET /api/notifications — my latest notifications and unread count
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return jsonError(401, 'Unauthorized')
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: session.user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId: session.user.id, readAt: null } }),
  ])
  return NextResponse.json({ unread, items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() })) })
}
