import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { todayIn } from '@/lib/booking/time'
import { sendRenewalReminderEmail } from '@/lib/mail'

// POST /api/memberships/renewal-reminders { venueId?, membershipIds: string[] } — email renewal reminders
// (billing:edit → owners and managers). Members without an email are skipped; each send is recorded.
export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as { venueId?: unknown; membershipIds?: unknown }
    const ids = Array.isArray(body.membershipIds) ? [...new Set(body.membershipIds.filter((x): x is string => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(x)))] : []
    if (!ids.length) return jsonError(400, 'Choose at least one membership')
    if (ids.length > 100) return jsonError(400, 'At most 100 reminders at a time')
    const ctx = await requireVenue(typeof body.venueId === 'string' ? body.venueId : null, 'billing', 'edit')
    if (ctx instanceof Response) return ctx

    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.access.venueId }, select: { name: true, timezone: true, currency: true } })
    const today = todayIn(venue.timezone)
    // Only this venue's active memberships — ids from other venues are silently ignored.
    const memberships = await prisma.membership.findMany({
      where: { id: { in: ids }, venueId: ctx.access.venueId, status: 'ACTIVE' },
      include: { player: { select: { name: true, email: true } }, plan: { select: { name: true, price: true } } },
    })
    const fmtDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    const fmtMoney = (n: number) => { try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: venue.currency }).format(n) } catch { return `${venue.currency} ${n.toFixed(2)}` } }

    const sent: string[] = []
    const noEmail: string[] = []
    const failed: string[] = []
    for (const m of memberships) {
      if (!m.player.email) { noEmail.push(m.player.name); continue }
      try {
        await sendRenewalReminderEmail(m.player.email, {
          playerName: m.player.name, venueName: venue.name, planName: m.plan.name, endDate: fmtDate(m.endDate),
          price: fmtMoney(Number(m.plan.price)), expired: m.endDate < today,
        })
        await prisma.membership.update({ where: { id: m.id }, data: { renewalReminderSentAt: new Date() } })
        sent.push(m.player.name)
      } catch (err) {
        console.error('[renewal reminder]', err)
        failed.push(m.player.name)
      }
    }
    return NextResponse.json({ sent, noEmail, failed, notFound: ids.length - memberships.length })
  } catch (err) {
    return handleError(err, 'renewal reminders POST')
  }
}
