import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

type RulePayload = { label: string; days: string[]; startTime: string; endTime: string; price: string }
type SportPricingPayload = { sportId: string; rules: RulePayload[] }

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await params
    const venue = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
    if (!venue) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { sports } = await req.json() as { sports: SportPricingPayload[] }

    await prisma.pricingRule.deleteMany({ where: { venueId: id } })

    const rows = sports.flatMap(({ sportId, rules }) =>
      rules.map((r) => ({
        venueId: id,
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
    console.error('[venues/pricing POST]', err)
    return NextResponse.json({ error: 'Failed to save pricing' }, { status: 500 })
  }
}
