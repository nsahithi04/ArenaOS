// Payments ledger, pending balances and membership renewals.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) }))
const mail = vi.hoisted(() => ({ sendRenewalReminderEmail: vi.fn(async () => ({})), sendInviteEmail: vi.fn(), sendOtpEmail: vi.fn(), sendVerificationEmail: vi.fn() }))
vi.mock('@/lib/mail', () => mail)

import * as payments from '@/app/api/payments/route'
import * as pending from '@/app/api/payments/pending/route'
import * as renewals from '@/app/api/memberships/renewals/route'
import * as reminders from '@/app/api/memberships/renewal-reminders/route'
import * as bookingPayments from '@/app/api/bookings/[id]/payments/route'
import { createBooking } from '@/lib/booking/service'
import { addDays, todayIn } from '@/lib/booking/time'
import { ensurePresetRoles } from '@/lib/team/presets'
import { monthsInclusive } from '@/lib/payments/service'
import { bookingInput, prisma, resetDatabase, seedVenue } from './fixtures'

const enabled = !!process.env.TEST_DB_AVAILABLE
const as = (id: string | null) => { session.userId = id }
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://t${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const p1 = (id: string) => ({ params: Promise.resolve({ id }) })
const OWNER = { isOwner: true, canCorrect: true }

let V: Awaited<ReturnType<typeof seedVenue>>
let employee: { id: string }
let today: string
let splitBookingId: string
let halfBookingId: string

describe.skipIf(!enabled)('payments, pending and renewals', () => {
  beforeAll(async () => {
    await resetDatabase()
    V = await seedVenue('pay')
    today = todayIn(V.venue.timezone)
    await ensurePresetRoles(prisma, V.venue.id)
    const role = await prisma.venueRole.findFirstOrThrow({ where: { venueId: V.venue.id, preset: 'EMPLOYEE' } })
    employee = await prisma.user.create({ data: { email: 'emp@pay.test', name: 'Emp' } })
    await prisma.venueMember.create({ data: { venueId: V.venue.id, userId: employee.id, roleId: role.id, email: 'emp@pay.test', name: 'Emp', status: 'active' } })

    const d = addDays(today, 2)
    splitBookingId = (await createBooking(prisma, V.venue.id, V.owner.id, bookingInput(V.court1.id, { customer: 'Sam Split', date: d, startMin: 600, endMin: 660, amount: 20 }) as never, OWNER))!.id
    halfBookingId = (await createBooking(prisma, V.venue.id, V.owner.id, bookingInput(V.court2.id, { customer: 'Hal Half', date: d, startMin: 600, endMin: 660, amount: 20 }) as never, OWNER))!.id
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('records each payment as its own ledger row', async () => {
    as(V.owner.id)
    for (const amount of [10, 10]) {
      expect((await bookingPayments.POST(req('POST', '/x', { method: 'CASH', amount }), p1(splitBookingId))).status).toBe(201)
    }
    expect((await bookingPayments.POST(req('POST', '/x', { method: 'UPI', amount: 10 }), p1(halfBookingId))).status).toBe(201)
    expect((await bookingPayments.POST(req('POST', '/x', { kind: 'REFUND', method: 'CASH', amount: 5 }), p1(splitBookingId))).status).toBe(201)

    const all = await (await payments.GET(req('GET', '/api/payments'))).json()
    const sam = all.items.filter((p: { payer: string }) => p.payer === 'Sam Split')
    expect(sam.map((p: { kind: string; signedAmount: number }) => [p.kind, p.signedAmount]).sort()).toEqual([['PAYMENT', 10], ['PAYMENT', 10], ['REFUND', -5]])
    expect(all.totals).toEqual({ received: 30, refunded: 5, net: 25, count: 4 })
    expect(sam[0]).toMatchObject({ type: 'BOOKING', bookingId: splitBookingId, recordedBy: 'pay Owner' })
  })

  it('searches, filters and sorts the ledger, and exports CSV', async () => {
    as(V.owner.id)
    const q = await (await payments.GET(req('GET', '/api/payments?q=hal'))).json()
    expect(q.items.map((p: { payer: string }) => p.payer)).toEqual(['Hal Half'])
    const refunds = await (await payments.GET(req('GET', '/api/payments?kind=REFUND'))).json()
    expect(refunds.totals).toMatchObject({ received: 0, refunded: 5, count: 1 })
    const upi = await (await payments.GET(req('GET', '/api/payments?method=UPI'))).json()
    expect(upi.items).toHaveLength(1)
    const memberships = await (await payments.GET(req('GET', '/api/payments?type=MEMBERSHIP'))).json()
    expect(memberships.items).toHaveLength(0)
    const byAmount = await (await payments.GET(req('GET', '/api/payments?sort=amount&order=asc'))).json()
    expect(byAmount.items.map((p: { amount: number }) => p.amount)).toEqual([5, 10, 10, 10])
    const future = await (await payments.GET(req('GET', `/api/payments?from=${addDays(today, 1)}&to=${addDays(today, 5)}`))).json()
    expect(future.items).toHaveLength(0) // payments are dated when received (today), not by booking date
    const csv = await (await payments.GET(req('GET', '/api/payments?format=csv'))).text()
    expect(csv.split('\n')).toHaveLength(5)
    expect(csv).toContain('-5.00')
  })

  it('lists everything still owed, including partial payments of every kind', async () => {
    as(V.owner.id)
    const plan = await prisma.membershipPlan.create({ data: { venueId: V.venue.id, name: 'Monthly', durationMonths: 1, price: 99 } })
    const mia = await prisma.player.create({ data: { venueId: V.venue.id, name: 'Mia Member' } })
    const m = await prisma.membership.create({ data: { venueId: V.venue.id, playerId: mia.id, planId: plan.id, startDate: today, endDate: addDays(today, 29), price: 99 } })
    await prisma.payment.create({ data: { venueId: V.venue.id, membershipId: m.id, method: 'CASH', amount: 50 } })

    const cls = await prisma.class.create({ data: { venueId: V.venue.id, name: 'Juniors', courtIds: [V.court1.id], days: ['MONDAY'], startMin: 960, endMin: 1020, startDate: addDays(today, -40), endDate: addDays(today, 60), fee: 120, feePeriod: 'MONTH' } })
    const stu = await prisma.player.create({ data: { venueId: V.venue.id, name: 'Stu Student' } })
    const enr = await prisma.enrollment.create({ data: { venueId: V.venue.id, classId: cls.id, playerId: stu.id, createdAt: new Date(Date.now() - 40 * 86400000) } })
    await prisma.payment.create({ data: { venueId: V.venue.id, enrollmentId: enr.id, method: 'CASH', amount: 120 } })

    const t = await prisma.tournament.create({ data: { venueId: V.venue.id, name: 'Cup', courtIds: [V.court1.id], startDate: addDays(today, 30), endDate: addDays(today, 30), startMin: 540, endMin: 600, entryFee: 20 } })
    await prisma.tournamentEntrant.create({ data: { venueId: V.venue.id, tournamentId: t.id, name: 'Tia Tourney' } })

    const r = await (await pending.GET(req('GET', '/api/payments/pending'))).json()
    const due = Object.fromEntries(r.items.map((i: { payer: string; due: number }) => [i.payer, i.due]))
    expect(due['Hal Half']).toBe(10) // $20 booking, $10 paid
    expect(due['Sam Split']).toBe(5) // paid 20, refunded 5
    expect(due['Mia Member']).toBe(49)
    expect(due['Tia Tourney']).toBe(20)
    // Monthly class fee: enrolled ~40 days ago → 2 or 3 calendar months so far, 1 paid
    const months = monthsInclusive(addDays(today, -40), today)
    expect(due['Stu Student']).toBe(120 * months - 120)
    expect(r.totalDue).toBe(Math.round((10 + 5 + 49 + 20 + 120 * months - 120) * 100) / 100)
    expect(r.byType.TOURNAMENT).toEqual({ count: 1, due: 20 })

    const only = await (await pending.GET(req('GET', '/api/payments/pending?type=MEMBERSHIP'))).json()
    expect(only.items.map((i: { payer: string }) => i.payer)).toEqual(['Mia Member'])
  })

  it('finds memberships to renew and emails reminders', async () => {
    as(V.owner.id)
    const plan = await prisma.membershipPlan.findFirstOrThrow({ where: { venueId: V.venue.id } })
    const mk = async (name: string, email: string | null, start: string, end: string) => {
      const p = await prisma.player.create({ data: { venueId: V.venue.id, name, email } })
      return prisma.membership.create({ data: { venueId: V.venue.id, playerId: p.id, planId: plan.id, startDate: start, endDate: end, price: 99 } })
    }
    const soon = await mk('Erin Ending', 'erin@example.test', addDays(today, -25), addDays(today, 5))
    const ended = await mk('Pat Past', null, addDays(today, -40), addDays(today, -10))
    await mk('Lou Later', 'lou@example.test', addDays(today, -1), addDays(today, 90)) // not due
    const renewedOld = await mk('Rae Renewed', 'rae@example.test', addDays(today, -28), addDays(today, 2))
    await prisma.membership.create({ data: { venueId: V.venue.id, playerId: renewedOld.playerId, planId: plan.id, startDate: addDays(today, 3), endDate: addDays(today, 32), price: 99 } })

    const list = await (await renewals.GET(req('GET', '/api/memberships/renewals?within=30&expired=60'))).json()
    const names = list.items.map((i: { playerName: string }) => i.playerName)
    expect(names).toContain('Erin Ending')
    expect(names).toContain('Pat Past')
    expect(names).not.toContain('Lou Later')
    expect(names).not.toContain('Rae Renewed') // already renewed
    expect(list.items.find((i: { playerName: string }) => i.playerName === 'Pat Past')).toMatchObject({ state: 'EXPIRED', daysLeft: -10 })

    const other = await seedVenue('payother')
    const foreign = await prisma.membership.create({ data: { venueId: other.venue.id, playerId: (await prisma.player.create({ data: { venueId: other.venue.id, name: 'X', email: 'x@example.test' } })).id, planId: (await prisma.membershipPlan.create({ data: { venueId: other.venue.id, name: 'P', durationMonths: 1, price: 1 } })).id, startDate: today, endDate: today, price: 1 } })

    const r = await (await reminders.POST(req('POST', '/x', { membershipIds: [soon.id, ended.id, foreign.id] }))).json()
    expect(r).toEqual({ sent: ['Erin Ending'], noEmail: ['Pat Past'], failed: [], notFound: 1 })
    expect(mail.sendRenewalReminderEmail).toHaveBeenCalledTimes(1)
    expect(mail.sendRenewalReminderEmail).toHaveBeenCalledWith('erin@example.test', expect.objectContaining({ playerName: 'Erin Ending', planName: 'Monthly', expired: false }))
    expect((await prisma.membership.findUniqueOrThrow({ where: { id: soon.id } })).renewalReminderSentAt).not.toBeNull()
    const again = await (await renewals.GET(req('GET', '/api/memberships/renewals'))).json()
    expect(again.items.find((i: { playerName: string }) => i.playerName === 'Erin Ending').remindedAt).not.toBeNull()
  })

  it('is for owners and managers only', async () => {
    as(employee.id)
    expect((await payments.GET(req('GET', '/api/payments'))).status).toBe(403)
    expect((await pending.GET(req('GET', '/api/payments/pending'))).status).toBe(403)
    expect((await renewals.GET(req('GET', '/api/memberships/renewals'))).status).toBe(403)
    expect((await reminders.POST(req('POST', '/x', { membershipIds: ['abc'] }))).status).toBe(403)
  })
})
