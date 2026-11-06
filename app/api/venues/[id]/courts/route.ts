import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

type CourtPayload = { id?: string; name: string; type: string; capacity: number; description: string; sportId: string; images?: string[] }

// Saves the full court list for a venue.
//
// Courts are upserted by id instead of delete-all/recreate: bookings reference
// courts, so recreating them would fail (FK) and would orphan booking history.
// Courts removed in the UI are hard-deleted only when nothing references them;
// otherwise they are deactivated (isActive = false) and disappear from booking screens.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
    if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { courts } = (await req.json()) as { courts: CourtPayload[] }
    if (!Array.isArray(courts)) return NextResponse.json({ error: 'courts must be an array' }, { status: 400 })

    await prisma.$transaction(async (tx) => {
      const existing = await tx.court.findMany({ where: { venueId: id }, select: { id: true } })
      const existingIds = new Set(existing.map((c) => c.id))
      const keep = new Set<string>()

      for (const c of courts) {
        const data = {
          sportId: c.sportId || null,
          name: c.name,
          type: c.type === 'Outdoor' ? ('OUTDOOR' as const) : ('INDOOR' as const),
          capacity: c.capacity,
          description: c.description || null,
          images: c.images ?? [],
          isActive: true,
        }
        if (c.id && existingIds.has(c.id)) {
          keep.add(c.id)
          await tx.court.update({ where: { id: c.id }, data })
        } else {
          await tx.court.create({ data: { venueId: id, ...data } })
        }
      }

      const removed = [...existingIds].filter((cid) => !keep.has(cid))
      if (removed.length) {
        const referenced = await tx.booking.findMany({ where: { courtId: { in: removed } }, select: { courtId: true }, distinct: ['courtId'] })
        const pricing = await tx.pricingRule.findMany({ where: { courtId: { in: removed } }, select: { courtId: true }, distinct: ['courtId'] })
        const inUse = new Set([...referenced, ...pricing].map((r) => r.courtId!))
        const deletable = removed.filter((cid) => !inUse.has(cid))
        if (deletable.length) await tx.court.deleteMany({ where: { id: { in: deletable } } })
        const deactivate = removed.filter((cid) => inUse.has(cid))
        if (deactivate.length) await tx.court.updateMany({ where: { id: { in: deactivate } }, data: { isActive: false } })
      }
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[venues/courts POST]', err)
    return NextResponse.json({ error: 'Failed to save courts' }, { status: 500 })
  }
}
