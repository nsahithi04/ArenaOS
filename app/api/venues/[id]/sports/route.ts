import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
    if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { sports } = await req.json()

    await prisma.sport.deleteMany({ where: { venueId: id } })
    if (sports?.length) {
      await prisma.sport.createMany({
        data: sports.map((s: { name: string; emoji?: string }) => ({
          venueId: id, name: s.name, emoji: s.emoji ?? null,
        })),
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[venues/sports POST]', err)
    return NextResponse.json({ error: 'Failed to save sports' }, { status: 500 })
  }
}
