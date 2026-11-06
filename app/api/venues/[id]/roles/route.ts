import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

async function assertAccess(userId: string, venueId: string) {
  const owned = await prisma.venue.findFirst({ where: { id: venueId, ownerId: userId } })
  if (owned) return true
  const member = await prisma.venueMember.findFirst({ where: { venueId, userId, status: 'active' } })
  return !!member
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  if (!(await assertAccess(session.user.id, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const roles = await prisma.venueRole.findMany({ where: { venueId: id }, orderBy: { createdAt: 'asc' } })
  return NextResponse.json(roles)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  // Only owners can create roles
  const owned = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
  if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { name, color, permissions } = await req.json()
    const role = await prisma.venueRole.create({ data: { venueId: id, name, color, permissions } })
    return NextResponse.json(role)
  } catch (err) {
    console.error('[roles POST]', err)
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 })
  }
}
