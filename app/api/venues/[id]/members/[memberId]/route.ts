import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, memberId } = await params
  const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
  if (!venue) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { roleId } = await req.json()
    const member = await prisma.venueMember.update({
      where: { id: memberId },
      data: { roleId: roleId ?? null },
      include: { role: true },
    })
    return NextResponse.json(member)
  } catch (err) {
    console.error('[members PATCH]', err)
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, memberId } = await params
  const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
  if (!venue) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await prisma.venueMember.delete({ where: { id: memberId } })
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[members DELETE]', err)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
