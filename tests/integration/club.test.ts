// Memberships and coaching classes, through the API routes.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) }))

import * as plans from '@/app/api/membership-plans/route'
import * as memberships from '@/app/api/memberships/route'
import * as membershipById from '@/app/api/memberships/[id]/route'
import * as membershipPayments from '@/app/api/memberships/[id]/payments/route'
import * as classes from '@/app/api/classes/route'
import * as classById from '@/app/api/classes/[id]/route'
import * as enrollments from '@/app/api/classes/[id]/enrollments/route'
import * as bookings from '@/app/api/bookings/route'
import * as bookingById from '@/app/api/bookings/[id]/route'
import * as blockById from '@/app/api/court-blocks/[id]/route'
import * as players from '@/app/api/players/route'
import * as dashboard from '@/app/api/dashboard/route'
import { ensurePresetRoles } from '@/lib/team/presets'
import { addDays, todayIn } from '@/lib/booking/time'
import { membershipEndDate } from '@/lib/club/schedule'
import { prisma, resetDatabase, seedVenue } from './fixtures'

const enabled = !!process.env.TEST_DB_AVAILABLE
const as = (id: string | null) => { session.userId = id }
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://t${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const p1 = (id: string) => ({ params: Promise.resolve({ id }) })

let V: Awaited<ReturnType<typeof seedVenue>>
let employee: { id: string }
let today: string

// 2 weeks from now, on a Monday-based week: pick the next Monday and Wednesday
function nextWeekday(from: string, dow: number) {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(from, i)
    if (new Date(`${d}T00:00:00Z`).getUTCDay() === dow) return d
  }
  throw new Error('unreachable')
}

describe.skipIf(!enabled)('memberships and classes', () => {
  beforeAll(async () => {
    await resetDatabase()
    V = await seedVenue('club')
    today = todayIn(V.venue.timezone)
    await ensurePresetRoles(prisma, V.venue.id)
    const role = await prisma.venueRole.findFirstOrThrow({ where: { venueId: V.venue.id, preset: 'EMPLOYEE' } })
    employee = await prisma.user.create({ data: { email: 'emp@club.test', name: 'Emp' } })
    await prisma.venueMember.create({ data: { venueId: V.venue.id, userId: employee.id, roleId: role.id, email: 'emp@club.test', name: 'Emp', status: 'active' } })
  })
  afterAll(async () => { await prisma.$disconnect() })

  let monthly: string
  let membershipId: string
  let memberPlayerId: string

  it('owners create plans; employees cannot', async () => {
    as(employee.id)
    expect((await plans.POST(req('POST', '/x', { name: 'Nope', durationMonths: 1, price: 10 }))).status).toBe(403)
    as(V.owner.id)
    const r = await plans.POST(req('POST', '/x', { name: 'Monthly Unlimited', durationMonths: 1, price: 99 }))
    expect(r.status).toBe(201)
    monthly = (await r.json()).id
    expect((await plans.POST(req('POST', '/x', { name: 'Bad', durationMonths: 0, price: 10 }))).status).toBe(400)
    const list = await (await plans.GET(req('GET', '/x'))).json()
    expect(list[0]).toMatchObject({ name: 'Monthly Unlimited', durationMonths: 1, price: 99, isActive: true })
  })

  it('front desk sells a membership to a new player, with part payment', async () => {
    as(employee.id)
    const r = await memberships.POST(req('POST', '/x', { newPlayer: { name: 'Mia Member', phone: '+1 555 0199' }, planId: monthly, startDate: today, payment: { amount: 50, method: 'UPI' } }))
    expect(r.status).toBe(201)
    ;({ id: membershipId, playerId: memberPlayerId } = await r.json())
    const list = await (await memberships.GET(req('GET', '/x?status=current'))).json()
    const m = list.items.find((x: { id: string }) => x.id === membershipId)
    expect(m).toMatchObject({ playerName: 'Mia Member', state: 'ACTIVE', price: 99, paid: 50, balance: 49 })
    expect(m).toMatchObject({ startDate: today, endDate: membershipEndDate(today, 1) })
    // Pay the rest; overpaying is refused
    expect((await membershipPayments.POST(req('POST', '/x', { amount: 60, method: 'CASH' }), p1(membershipId))).status).toBe(422)
    expect((await membershipPayments.POST(req('POST', '/x', { amount: 49, method: 'CASH' }), p1(membershipId))).status).toBe(201)
  })

  it('member bookings are covered by the membership (price 0, paid)', async () => {
    as(employee.id)
    const found = await (await players.GET(req('GET', '/x?q=mia&membersOnly=1'))).json()
    expect(found).toEqual([expect.objectContaining({ id: memberPlayerId, membership: expect.objectContaining({ id: membershipId, planName: 'Monthly Unlimited' }) })])
    const r = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'Mia Member', source: 'PHONE', date: today, start: '22:00', end: '23:00', membershipId, overrideHours: true }))
    expect(r.status).toBe(201)
    const { id } = await r.json()
    const b = await (await bookingById.GET(req('GET', '/x'), p1(id))).json()
    expect(b).toMatchObject({ amount: 0, payment: 'PAID', membershipId, membershipPlan: 'Monthly Unlimited', playerId: memberPlayerId })
    // Rescheduling keeps it free (no re-pricing)
    const moved = await (await bookingById.PATCH(req('PATCH', '/x', { date: today, start: '21:00', end: '22:00', overrideHours: true }), p1(id))).json()
    expect(moved.amount).toBe(0)
    // Can't pay "on top" of a membership at booking time
    const withPay = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'Mia', source: 'PHONE', date: today, start: '22:00', end: '23:00', membershipId, overrideHours: true, initialPayment: { amount: 5, method: 'CASH' } }))
    expect(withPay.status).toBe(400)
  })

  it('memberships only cover their own dates (and sport, and not when cancelled)', async () => {
    as(employee.id)
    const far = addDays(today, 60)
    const r = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'Mia', source: 'PHONE', date: far, start: '10:00', end: '11:00', membershipId }))
    expect(r.status).toBe(422)
    expect((await r.json()).code).toBe('MEMBERSHIP_NOT_VALID')

    as(V.owner.id)
    const sport2 = await prisma.sport.create({ data: { venueId: V.venue.id, name: 'Tennis' } })
    const tennisPlan = await (await plans.POST(req('POST', '/x', { name: 'Tennis only', durationMonths: 12, price: 500, sportId: sport2.id }))).json()
    const tm = await (await memberships.POST(req('POST', '/x', { playerId: memberPlayerId, planId: tennisPlan.id, startDate: today }))).json()
    const wrongSport = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'Mia', source: 'PHONE', date: today, start: '06:00', end: '07:00', membershipId: tm.id }))
    expect((await wrongSport.json()).code).toBe('MEMBERSHIP_WRONG_SPORT')

    // Employees can't cancel memberships; owners can, and it stops covering bookings
    as(employee.id)
    expect((await membershipById.PATCH(req('PATCH', '/x', { action: 'cancel' }), p1(tm.id))).status).toBe(403)
    as(V.owner.id)
    expect((await membershipById.PATCH(req('PATCH', '/x', { action: 'cancel' }), p1(tm.id))).status).toBe(200)
  })

  let classId: string
  const mon = () => nextWeekday(today, 1)
  // Wednesday/Friday of the class's first week (always after its Monday start, whatever today is)
  const wed = () => addDays(mon(), 2)

  it('a class reserves its courts on every class day; clashes are reported first', async () => {
    as(V.owner.id)
    // An existing booking on the first Monday at the class time
    const clash = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'Early Bird', source: 'PHONE', date: mon(), start: '17:00', end: '18:00' }))
    expect(clash.status).toBe(201)

    const body = {
      name: 'Junior Coaching', coachName: 'Coach Lee', courtIds: [V.court1.id], days: ['MONDAY', 'WEDNESDAY'],
      start: '16:30', end: '18:00', startDate: mon(), endDate: addDays(mon(), 13), capacity: 2, fee: 120, feePeriod: 'MONTH',
    }
    as(employee.id)
    expect((await classes.POST(req('POST', '/x', body))).status).toBe(403)
    as(V.owner.id)
    const refused = await classes.POST(req('POST', '/x', body))
    expect(refused.status).toBe(409)
    const det = await refused.json()
    expect(det.details.conflicts).toEqual([expect.objectContaining({ date: mon(), what: 'Booking: Early Bird' })])

    const ok = await classes.POST(req('POST', '/x', { ...body, skipConflicts: true }))
    expect(ok.status).toBe(201)
    const created = await ok.json()
    classId = created.id
    expect(created).toMatchObject({ sessions: 3, skipped: 1 }) // 2 Mondays + 2 Wednesdays − 1 clash

    // Courts are now blocked at those times
    const blocked = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'X', source: 'PHONE', date: wed(), start: '17:00', end: '18:00' }))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error).toContain('Junior Coaching')
    // Other courts and other times are fine
    expect((await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'Y', source: 'PHONE', date: wed(), start: '17:00', end: '18:00' }))).status).toBe(201)

    // A class session can't be removed from the calendar like a maintenance block
    const session1 = await prisma.courtBlock.findFirstOrThrow({ where: { classId } })
    expect((await blockById.DELETE(req('DELETE', '/x'), p1(session1.id))).status).toBe(409)
  })

  it('enrolment respects capacity, including simultaneous enrolments', async () => {
    as(employee.id)
    const results = await Promise.all(['Ana', 'Ben', 'Cal'].map((n) =>
      enrollments.POST(req('POST', '/x', { newPlayer: { name: n }, payment: { amount: 120, method: 'CASH' } }), p1(classId))))
    const statuses = results.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 201, 409]) // capacity 2
    const full = await (await classById.GET(req('GET', '/x'), p1(classId))).json()
    expect(full.students.filter((s: { status: string }) => s.status === 'ACTIVE')).toHaveLength(2)
    expect(full.students.every((s: { paid: number }) => s.paid === 120)).toBe(true)
  })

  it('rescheduling and cancelling a class moves and frees court time', async () => {
    as(V.owner.id)
    // Move the class to Fridays on court 2
    const r = await classById.PATCH(req('PATCH', '/x', { days: ['FRIDAY'], courtIds: [V.court2.id] }), p1(classId))
    expect(r.status).toBe(200)
    expect((await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'Free now', source: 'PHONE', date: wed(), start: '17:00', end: '18:00' }))).status).toBe(201)
    const friday = addDays(mon(), 4)
    expect((await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'Z', source: 'PHONE', date: friday, start: '17:00', end: '18:00' }))).status).toBe(409)

    // Cancel: future sessions freed
    const c = await classById.DELETE(req('DELETE', '/x'), p1(classId))
    expect(c.status).toBe(200)
    expect((await c.json()).freedSessions).toBeGreaterThan(0)
    expect((await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'Z', source: 'PHONE', date: friday, start: '17:00', end: '18:00' }))).status).toBe(201)
  })

  it('dashboard splits collected revenue into bookings, memberships and classes', async () => {
    as(V.owner.id)
    const d = await (await dashboard.GET(req('GET', '/api/dashboard?range=today'))).json()
    const byType = Object.fromEntries(d.current.byType.map((t: { key: string; collected: number }) => [t.key, t.collected]))
    expect(byType.MEMBERSHIP).toBe(99) // 50 + 49 (the cancelled tennis membership was never paid)
    expect(byType.CLASS).toBe(240) // two students × 120
    expect(d.current.collected).toBe(byType.BOOKING + byType.MEMBERSHIP + byType.CLASS)
  })
})
