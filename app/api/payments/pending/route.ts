import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hasPermission } from '@/lib/booking/access'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn } from '@/lib/booking/time'
import { PAYMENT_TYPES, pendingBalances, type PaymentType } from '@/lib/payments/service'

// GET /api/payments/pending?venueId&type&q&sort=newest|oldest|due|name — everything still owed (billing:view). Default: newest first.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'billing', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.access.venueId }, select: { timezone: true, currency: true } })
    let items = await pendingBalances(prisma, ctx.access.venueId, venue.timezone, todayIn(venue.timezone), { contact: hasPermission(ctx.access, 'bookings', 'edit') })
    const byType = Object.fromEntries(PAYMENT_TYPES.map((t) => [t, { count: 0, due: 0 }])) as Record<PaymentType, { count: number; due: number }>
    for (const i of items) { byType[i.type].count++; byType[i.type].due = Math.round((byType[i.type].due + i.due) * 100) / 100 }
    const types = sp.get('type')?.split(',').filter((t) => (PAYMENT_TYPES as readonly string[]).includes(t))
    if (types?.length) items = items.filter((i) => types.includes(i.type))
    const q = sp.get('q')?.trim().toLowerCase()
    if (q) items = items.filter((i) => i.payer.toLowerCase().includes(q) || i.detail.toLowerCase().includes(q))
    const sort = sp.get('sort')
    items.sort(
      sort === 'name' ? (a, b) => a.payer.localeCompare(b.payer)
      : sort === 'due' ? (a, b) => b.due - a.due
      : sort === 'oldest' || sort === 'date' ? (a, b) => a.date.localeCompare(b.date)
      : (a, b) => b.date.localeCompare(a.date), // newest first
    )
    const totalDue = Math.round(items.reduce((s, i) => s + i.due, 0) * 100) / 100
    return NextResponse.json({ items, totalDue, byType, currency: venue.currency })
  } catch (err) {
    return handleError(err, 'pending GET')
  }
}
