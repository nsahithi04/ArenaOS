import { NextResponse } from 'next/server'
import { requireVenue } from '@/lib/booking/route-helpers'
import { prisma } from '@/lib/db'
import { isValidTimeZone } from '@/lib/booking/time'

const CURRENCY_RE = /^[A-Z]{3}$/

const TYPE_MAP: Record<string, 'PRIVATE' | 'PUBLIC' | 'SEMI_PUBLIC'> = {
  Private: 'PRIVATE', Public: 'PUBLIC', 'Semi-Public': 'SEMI_PUBLIC',
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'venue', 'view')
  if (ctx instanceof Response) return ctx
  const venue = await prisma.venue.findFirst({
    where: { id },
    include: { images: true, sports: true, courts: true, operatingHours: true, pricingRules: true, amenities: true },
  })
  if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(venue)
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx

  try {
    const venue = await prisma.venue.findFirst({ where: { id } })
    if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { name, description, phone, email, website, address, city, state, zip, country, type, logoUrl, coverUrl, galleryUrls, amenities, timezone, currency } = await req.json()

    if (timezone !== undefined && (typeof timezone !== 'string' || !isValidTimeZone(timezone))) {
      return NextResponse.json({ error: 'Unknown time zone' }, { status: 400 })
    }
    if (currency !== undefined && (typeof currency !== 'string' || !CURRENCY_RE.test(currency))) {
      return NextResponse.json({ error: 'Currency must be a 3-letter ISO code' }, { status: 400 })
    }

    const updated = await prisma.venue.update({
      where: { id },
      data: {
        ...(name && { name }),
        description, phone, email, website, address, city, state, zip, country,
        ...(type && { type: TYPE_MAP[type] ?? venue.type }),
        ...(timezone && { timezone }),
        ...(currency && { currency }),
      },
    })

    // Rebuild amenities
    if (Array.isArray(amenities)) {
      await prisma.venueAmenity.deleteMany({ where: { venueId: id } })
      if (amenities.length) {
        await prisma.venueAmenity.createMany({
          data: amenities.map((name: string) => ({ venueId: id, name })),
          skipDuplicates: true,
        })
      }
    }

    // Rebuild images if any provided
    if (logoUrl !== undefined || coverUrl !== undefined || galleryUrls !== undefined) {
      await prisma.venueImage.deleteMany({ where: { venueId: id } })
      const rows = [
        ...(logoUrl ? [{ venueId: id, imageUrl: logoUrl, isLogo: true, isCover: false }] : []),
        ...(coverUrl ? [{ venueId: id, imageUrl: coverUrl, isCover: true, isLogo: false }] : []),
        ...((galleryUrls as string[] | undefined) ?? []).map((url) => ({
          venueId: id, imageUrl: url, isCover: false, isLogo: false,
        })),
      ]
      if (rows.length) await prisma.venueImage.createMany({ data: rows })
    }

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[venues PATCH]', err)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }
}
