import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'

// GET /api/courts?venueId — active courts (needs bookings:view)
export async function GET(req: Request) {
  const ctx = await requireVenue(new URL(req.url).searchParams.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx

  const courts = await prisma.court.findMany({
    where: { venueId: ctx.access.venueId, isActive: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(courts)
}

// POST /api/courts — add a single court (needs venue:edit)
export async function POST(req: Request) {
  try {
    const { venueId, sportId, name, type, capacity, description, images } = (await readJson(req)) as Record<string, unknown>
    if (typeof name !== 'string' || !name.trim() || name.length > 80) {
      return NextResponse.json({ error: 'name is required (max 80 characters)' }, { status: 400 })
    }
    const ctx = await requireVenue(typeof venueId === 'string' ? venueId : null, 'venue', 'edit')
    if (ctx instanceof Response) return ctx

    if (typeof sportId === 'string' && sportId) {
      const sport = await prisma.sport.findFirst({ where: { id: sportId, venueId: ctx.access.venueId } })
      if (!sport) return NextResponse.json({ error: 'Sport not found for this venue' }, { status: 400 })
    }

    const court = await prisma.court.create({
      data: {
        venueId: ctx.access.venueId,
        sportId: typeof sportId === 'string' && sportId ? sportId : null,
        name: name.trim(),
        type: type === 'OUTDOOR' ? 'OUTDOOR' : 'INDOOR',
        capacity: Number.isInteger(capacity) && (capacity as number) > 0 ? (capacity as number) : 4,
        description: typeof description === 'string' ? description : null,
        images: Array.isArray(images) ? images.filter((i): i is string => typeof i === 'string') : [],
      },
    })
    return NextResponse.json(court, { status: 201 })
  } catch (err) {
    return handleError(err, 'courts POST')
  }
}
