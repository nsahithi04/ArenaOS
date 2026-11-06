import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

type CourtPayload = { name: string; type: string; capacity: number; description: string; sportId: string; images?: string[] }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
    if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { courts } = await req.json() as { courts: CourtPayload[] }

    await prisma.court.deleteMany({ where: { venueId: id } })
    if (courts?.length) {
      await prisma.court.createMany({
        data: courts.map((c) => ({
          venueId: id,
          sportId: c.sportId || null,
          name: c.name,
          type: c.type === 'Outdoor' ? 'OUTDOOR' : 'INDOOR',
          capacity: c.capacity,
          description: c.description || null,
          images: c.images ?? [],
        })),
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[venues/courts POST]', err)
    return NextResponse.json({ error: 'Failed to save courts' }, { status: 500 })
  }
}
