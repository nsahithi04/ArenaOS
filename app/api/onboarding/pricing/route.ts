import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

type RulePayload = {
  label: string
  days: string[]
  startTime: string
  endTime: string
  price: string
}

type SportPricingPayload = {
  sportId: string
  rules: RulePayload[]
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { sports } = await req.json() as { sports: SportPricingPayload[] }

    const venue = await prisma.venue.findFirst({
      where: { ownerId: session.user.id, isSetupDone: false },
    })
    if (!venue) return NextResponse.json({ error: 'No venue in progress' }, { status: 404 })

    await prisma.pricingRule.deleteMany({ where: { venueId: venue.id } })

    const rows = sports.flatMap(({ sportId, rules }) =>
      rules.map((r) => ({
        venueId: venue.id,
        sportId: sportId || null,
        label: r.label,
        days: r.days.join(','),
        startTime: r.startTime,
        endTime: r.endTime,
        priceUsd: parseFloat(r.price) || 0,
      }))
    )

    if (rows.length) await prisma.pricingRule.createMany({ data: rows })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[onboarding/pricing]', err)
    return NextResponse.json({ error: 'Failed to save pricing' }, { status: 500 })
  }
}
