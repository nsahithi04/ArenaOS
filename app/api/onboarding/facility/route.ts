import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { toSlug, ensureUniqueSlug } from '@/lib/slug'

const TYPE_MAP: Record<string, 'PRIVATE' | 'PUBLIC' | 'SEMI_PUBLIC'> = {
  Private: 'PRIVATE',
  Public: 'PUBLIC',
  'Semi-Public': 'SEMI_PUBLIC',
}

async function geocode(address: string, city: string, state: string, country: string) {
  try {
    const q = [address, city, state, country].filter(Boolean).join(', ')
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`,
      { headers: { 'User-Agent': 'GameOn/1.0 (gameon-app)' } },
    )
    const data = await res.json()
    if (data[0]) return { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) }
  } catch (e) {
    console.error('[geocode]', e)
  }
  return { latitude: null, longitude: null }
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const {
      name, description, phone, email, website,
      address, city, state, zip, country, type,
      logoUrl, coverUrl, galleryUrls,
    } = await req.json()

    if (!name) return NextResponse.json({ error: 'Facility name is required' }, { status: 400 })

    const { latitude, longitude } = await geocode(address ?? '', city ?? '', state ?? '', country ?? '')

    const existing = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
    })

    let venue
    if (existing) {
      venue = await prisma.venue.update({
        where: { id: existing.id },
        data: {
          name, description, phone, email, website,
          address, city, state, zip, country,
          latitude, longitude,
          type: TYPE_MAP[type] ?? 'PRIVATE',
          onboardingStep: 'SPORTS',
        },
      })
    } else {
      const baseSlug = toSlug(name)
      const taken = await prisma.venue.findMany({
        where: { slug: { startsWith: baseSlug } },
        select: { slug: true },
      })
      const slug = ensureUniqueSlug(baseSlug, taken.map((v) => v.slug))

      venue = await prisma.venue.create({
        data: {
          name, slug, description, phone, email, website,
          address, city, state, zip, country,
          latitude, longitude,
          type: TYPE_MAP[type] ?? 'PRIVATE',
          ownerId: session.user.id,
          onboardingStep: 'SPORTS',
        },
      })
    }

    await prisma.venueImage.deleteMany({ where: { venueId: venue.id } })
    const imageRows = [
      ...(logoUrl ? [{ venueId: venue.id, imageUrl: logoUrl, isLogo: true, isCover: false }] : []),
      ...(coverUrl ? [{ venueId: venue.id, imageUrl: coverUrl, isCover: true, isLogo: false }] : []),
      ...((galleryUrls as string[] | undefined) ?? []).map((url) => ({
        venueId: venue.id, imageUrl: url, isCover: false, isLogo: false,
      })),
    ]
    if (imageRows.length) await prisma.venueImage.createMany({ data: imageRows })

    return NextResponse.json({ venueId: venue.id })
  } catch (err) {
    console.error('[onboarding/facility]', err)
    return NextResponse.json({ error: 'Failed to save facility' }, { status: 500 })
  }
}
