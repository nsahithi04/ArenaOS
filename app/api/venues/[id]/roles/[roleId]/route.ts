import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roleId } = await params
  const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
  if (!venue) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { name, color, permissions } = await req.json()
    const role = await prisma.venueRole.update({ where: { id: roleId }, data: { name, color, permissions } })
    return NextResponse.json(role)
  } catch (err) {
    console.error('[roles PATCH]', err)
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; roleId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, roleId } = await params
  const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
  if (!venue) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await prisma.venueRole.delete({ where: { id: roleId } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[roles DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete role' }, { status: 500 })
  }
}
