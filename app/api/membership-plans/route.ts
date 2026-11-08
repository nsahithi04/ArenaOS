import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { createPlan } from '@/lib/club/service'
import { validatePlan } from '@/lib/club/validation'

// GET /api/membership-plans?venueId — plans with how many active members each has (bookings:view)
export async function GET(req: Request) {
  const ctx = await requireVenue(new URL(req.url).searchParams.get('venueId'), 'bookings', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const plans = await prisma.membershipPlan.findMany({
      where: { venueId: ctx.access.venueId },
      include: { sport: { select: { name: true } }, _count: { select: { memberships: { where: { status: 'ACTIVE' } } } } },
      orderBy: [{ isActive: 'desc' }, { durationMonths: 'asc' }, { price: 'asc' }],
    })
    return NextResponse.json(plans.map((p) => ({
      id: p.id, name: p.name, description: p.description, durationMonths: p.durationMonths, price: Number(p.price),
      sportId: p.sportId, sportName: p.sport?.name ?? null, isActive: p.isActive, memberships: p._count.memberships,
    })))
  } catch (err) {
    return handleError(err, 'plans GET')
  }
}

// POST /api/membership-plans — create a plan (venue:edit → owners and managers)
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const input = validatePlan(body)
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'venue', 'edit')
    if (ctx instanceof Response) return ctx
    const plan = await createPlan(prisma, ctx.access.venueId, input)
    return NextResponse.json({ id: plan.id }, { status: 201 })
  } catch (err) {
    return handleError(err, 'plans POST')
  }
}
