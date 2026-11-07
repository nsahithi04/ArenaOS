// Owner / Manager / Employee model: built-in roles, team hierarchy, and what
// each role can reach on the server.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) }))
const mail = vi.hoisted(() => ({ sendInviteEmail: vi.fn(async () => ({})) }))
vi.mock('@/lib/mail', () => mail)

import * as members from '@/app/api/venues/[id]/members/route'
import * as member from '@/app/api/venues/[id]/members/[memberId]/route'
import * as roles from '@/app/api/venues/[id]/roles/route'
import * as role from '@/app/api/venues/[id]/roles/[roleId]/route'
import * as venueById from '@/app/api/venues/[id]/route'
import * as sports from '@/app/api/venues/[id]/sports/route'
import * as pricing from '@/app/api/venues/[id]/pricing/route'
import * as dashboard from '@/app/api/dashboard/route'
import * as bookings from '@/app/api/bookings/route'
import * as payments from '@/app/api/bookings/[id]/payments/route'
import { ensurePresetRoles } from '@/lib/team/presets'
import * as bookingById from '@/app/api/bookings/[id]/route'
import { addDays, todayIn, zonedToUtc } from '@/lib/booking/time'
import { DATE, prisma, resetDatabase, seedVenue } from './fixtures'

const enabled = !!process.env.TEST_DB_AVAILABLE
const BASE = 'http://test.local'
const as = (id: string | null) => { session.userId = id }
const req = (method: string, path: string, body?: unknown) =>
  new Request(`${BASE}${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const p1 = (id: string) => ({ params: Promise.resolve({ id }) })
const p2 = (id: string, memberId: string) => ({ params: Promise.resolve({ id, memberId }) })
const pr = (id: string, roleId: string) => ({ params: Promise.resolve({ id, roleId }) })

let A: Awaited<ReturnType<typeof seedVenue>>
let B: Awaited<ReturnType<typeof seedVenue>>
let managerRoleId: string
let employeeRoleId: string
let manager: { id: string }
let employee: { id: string }

async function addMember(venueId: string, roleId: string, label: string) {
  const user = await prisma.user.create({ data: { email: `${label}@team.test`, name: label, role: 'VENUE_OWNER' } }) // self-registered type on purpose
  const m = await prisma.venueMember.create({ data: { venueId, userId: user.id, roleId, email: user.email, name: label, status: 'active' } })
  return { ...user, memberId: m.id }
}

describe.skipIf(!enabled)('owner / manager / employee', () => {
  beforeAll(async () => {
    await resetDatabase()
    A = await seedVenue('teama')
    B = await seedVenue('teamb')
    await ensurePresetRoles(prisma, A.venue.id)
    managerRoleId = (await prisma.venueRole.findFirstOrThrow({ where: { venueId: A.venue.id, preset: 'MANAGER' } })).id
    employeeRoleId = (await prisma.venueRole.findFirstOrThrow({ where: { venueId: A.venue.id, preset: 'EMPLOYEE' } })).id
    manager = await addMember(A.venue.id, managerRoleId, 'mgr')
    employee = await addMember(A.venue.id, employeeRoleId, 'emp')
  })
  afterAll(async () => { await prisma.$disconnect() })

  it('every venue gets locked Manager and Employee roles', async () => {
    as(A.owner.id)
    const list = await (await roles.GET(req('GET', '/x'), p1(B.venue.id))).json()
    expect(list).toHaveProperty('error') // owner A can't read venue B's roles
    as(B.owner.id)
    const bRoles = await (await roles.GET(req('GET', '/x'), p1(B.venue.id))).json()
    expect(bRoles.map((r: { name: string; preset: string }) => [r.name, r.preset])).toEqual([['Manager', 'MANAGER'], ['Employee', 'EMPLOYEE']])
    expect(bRoles[1].permissions).toEqual({ bookings: 'edit', venue: 'none', reports: 'none', billing: 'none', team: 'none' })

    as(A.owner.id)
    expect((await role.PATCH(req('PATCH', '/x', { permissions: { reports: 'view' } }), pr(A.venue.id, employeeRoleId))).status).toBe(403)
    expect((await role.DELETE(req('DELETE', '/x'), pr(A.venue.id, managerRoleId))).status).toBe(403)
    expect((await roles.POST(req('POST', '/x', { name: 'manager', permissions: {} }), p1(A.venue.id))).status).toBe(409)
    expect((await roles.POST(req('POST', '/x', { name: 'Coach', permissions: { bookings: 'view' } }), p1(A.venue.id))).status).toBe(201)
  })

  it('employees: bookings only, no dashboard, team or venue settings', async () => {
    as(employee.id)
    expect((await dashboard.GET(req('GET', `/api/dashboard?venueId=${A.venue.id}`))).status).toBe(403)
    expect((await members.GET(req('GET', '/x'), p1(A.venue.id))).status).toBe(403)
    expect((await roles.GET(req('GET', '/x'), p1(A.venue.id))).status).toBe(403)
    expect((await venueById.PATCH(req('PATCH', '/x', { name: 'Hacked' }), p1(A.venue.id))).status).toBe(403)
    expect((await sports.POST(req('POST', '/x', { sports: [] }), p1(A.venue.id))).status).toBe(403)

    expect((await bookings.GET(req('GET', `/api/bookings?venueId=${A.venue.id}`))).status).toBe(200)
    const created = await bookings.POST(req('POST', '/api/bookings', { venueId: A.venue.id, courtId: A.court1.id, customer: 'Walk in', source: 'WALK_IN', date: DATE, start: '10:00', end: '11:00', initialPayment: { amount: 20, method: 'CASH' } }))
    expect(created.status).toBe(201)
    const { id } = await created.json()
    // Can take payments but not issue refunds
    expect((await payments.POST(req('POST', '/x', { kind: 'REFUND', method: 'CASH', amount: 5 }), p1(id))).status).toBe(403)
  })

  it('managers: dashboard, revenue, venue settings, refunds and the team', async () => {
    as(manager.id)
    const d = await dashboard.GET(req('GET', `/api/dashboard?venueId=${A.venue.id}&range=custom&from=${DATE}&to=${DATE}`))
    expect(d.status).toBe(200)
    expect((await d.json()).current.gross).toBe(20)
    expect((await venueById.PATCH(req('PATCH', '/x', { description: 'Updated by manager' }), p1(A.venue.id))).status).toBe(200)
    expect((await pricing.POST(req('POST', '/x', { sports: [] }), p1(A.venue.id))).status).toBe(200)

    const team = await members.GET(req('GET', '/x'), p1(A.venue.id))
    expect(team.status).toBe(200)
    const body = await team.json()
    expect(body.owner.email).toBe(A.owner.email)
    expect(JSON.stringify(body)).not.toContain('inviteToken')
    expect(body.members.find((m: { name: string }) => m.name === 'mgr')).toMatchObject({ isYou: true, canManage: false })
    expect(body.members.find((m: { name: string }) => m.name === 'emp')).toMatchObject({ canManage: true })
  })

  it('managers can manage employees but not managers', async () => {
    as(manager.id)
    // Invite an employee (default role) → email sent with the Employee role
    const inv = await members.POST(req('POST', '/x', { name: 'New Hire', email: 'NEW.hire@team.test' }), p1(A.venue.id))
    expect(inv.status).toBe(201)
    const hire = await inv.json()
    expect(hire).toMatchObject({ email: 'new.hire@team.test', status: 'invited', roleId: employeeRoleId })
    expect(hire).not.toHaveProperty('inviteToken')
    expect(mail.sendInviteEmail).toHaveBeenCalledWith('new.hire@team.test', expect.objectContaining({ roleName: 'Employee', inviterName: 'mgr' }))

    // Cannot invite or promote to Manager
    expect((await members.POST(req('POST', '/x', { name: 'X', email: 'x@team.test', roleId: managerRoleId }), p1(A.venue.id))).status).toBe(403)
    expect((await member.PATCH(req('PATCH', '/x', { roleId: managerRoleId }), p2(A.venue.id, hire.id))).status).toBe(403)
    // Cannot remove themselves or another manager
    const mgrMemberId = (manager as unknown as { memberId: string }).memberId
    expect((await member.DELETE(req('DELETE', '/x'), p2(A.venue.id, mgrMemberId))).status).toBe(403)
    const other = await addMember(A.venue.id, managerRoleId, 'mgr2')
    expect((await member.DELETE(req('DELETE', '/x'), p2(A.venue.id, other.memberId))).status).toBe(403)
    // Can remove an employee
    expect((await member.DELETE(req('DELETE', '/x'), p2(A.venue.id, hire.id))).status).toBe(200)
    // Cannot create custom roles
    expect((await roles.POST(req('POST', '/x', { name: 'Boss', permissions: { team: 'edit' } }), p1(A.venue.id))).status).toBe(403)

    // The owner can do all of it
    as(A.owner.id)
    expect((await member.PATCH(req('PATCH', '/x', { roleId: employeeRoleId }), p2(A.venue.id, other.memberId))).status).toBe(200)
    expect((await members.POST(req('POST', '/x', { name: 'Co Manager', email: 'co@team.test', roleId: managerRoleId }), p1(A.venue.id))).status).toBe(201)
  })

  it('team changes are scoped to the venue', async () => {
    const bEmp = await addMember(B.venue.id, (await prisma.venueRole.findFirstOrThrow({ where: { venueId: B.venue.id, preset: 'EMPLOYEE' } })).id, 'bemp')
    as(A.owner.id)
    // A's owner using A's venue id with B's member id → not found, member untouched
    expect((await member.DELETE(req('DELETE', '/x'), p2(A.venue.id, bEmp.memberId))).status).toBe(404)
    expect((await member.PATCH(req('PATCH', '/x', { roleId: managerRoleId }), p2(A.venue.id, bEmp.memberId))).status).toBe(404)
    // Assigning another venue's role is rejected
    const aEmp = (employee as unknown as { memberId: string }).memberId
    const bMgrRole = await prisma.venueRole.findFirstOrThrow({ where: { venueId: B.venue.id, preset: 'MANAGER' } })
    expect((await member.PATCH(req('PATCH', '/x', { roleId: bMgrRole.id }), p2(A.venue.id, aEmp))).status).toBe(400)
    expect(await prisma.venueMember.count({ where: { id: bEmp.memberId } })).toBe(1)
  })

  it('custom roles grant exactly what they say, and edits apply immediately', async () => {
    as(A.owner.id)
    // A "Coach" who can only VIEW bookings
    const created = await roles.POST(req('POST', '/x', { name: 'Coach (view)', color: '#0891b2', permissions: { bookings: 'view' } }), p1(A.venue.id))
    expect(created.status).toBe(201)
    const coachRole = await created.json()
    expect(coachRole.permissions).toEqual({ bookings: 'view', venue: 'none', reports: 'none', billing: 'none', team: 'none' })
    const coach = await addMember(A.venue.id, coachRole.id, 'coach')

    as(coach.id)
    const list = await bookings.GET(req('GET', `/api/bookings?venueId=${A.venue.id}`))
    expect(list.status).toBe(200)
    expect((await list.json()).items.every((b: { phone: unknown }) => b.phone === null)).toBe(true) // view-only: no contact details
    const tryCreate = await bookings.POST(req('POST', '/api/bookings', { venueId: A.venue.id, courtId: A.court2.id, customer: 'X', source: 'PHONE', date: DATE, start: '15:00', end: '16:00' }))
    expect(tryCreate.status).toBe(403)
    expect((await dashboard.GET(req('GET', `/api/dashboard?venueId=${A.venue.id}`))).status).toBe(403)
    expect((await members.GET(req('GET', '/x'), p1(A.venue.id))).status).toBe(403)

    // Owner upgrades the custom role: now it can edit bookings and see reports
    as(A.owner.id)
    expect((await role.PATCH(req('PATCH', '/x', { permissions: { bookings: 'edit', reports: 'view' } }), pr(A.venue.id, coachRole.id))).status).toBe(200)
    as(coach.id)
    // (manual amount: an earlier test cleared this venue's pricing rules)
    expect((await bookings.POST(req('POST', '/api/bookings', { venueId: A.venue.id, courtId: A.court2.id, customer: 'X', source: 'PHONE', date: DATE, start: '15:00', end: '16:00', amount: 25 }))).status).toBe(201)
    expect((await dashboard.GET(req('GET', `/api/dashboard?venueId=${A.venue.id}`))).status).toBe(200)
    expect((await venueById.PATCH(req('PATCH', '/x', { description: 'no' }), p1(A.venue.id))).status).toBe(403)

    // Invalid permission values are rejected
    as(A.owner.id)
    expect((await role.PATCH(req('PATCH', '/x', { permissions: { bookings: 'admin' } }), pr(A.venue.id, coachRole.id))).status).toBe(400)

    // Deleting the role leaves its members with no access (not someone else's role)
    expect((await role.DELETE(req('DELETE', '/x'), pr(A.venue.id, coachRole.id))).status).toBe(200)
    as(coach.id)
    expect((await bookings.GET(req('GET', `/api/bookings?venueId=${A.venue.id}`))).status).toBe(403)
  })

  it('past bookings lock by age: employees today+, managers 7 days, owner always', async () => {
    const tz = A.venue.timezone
    const today = todayIn(tz)
    // Insert bookings directly (bypassing the rules under test) at various ages.
    const mk = async (date: string, hour: number, paid = 0) => {
      const b = await prisma.booking.create({
        data: { venueId: A.venue.id, courtId: A.court2.id, customer: `Age ${date}`, source: 'PHONE', status: 'CONFIRMED',
          startTime: zonedToUtc(date, hour * 60, tz), endTime: zonedToUtc(date, hour * 60 + 60, tz), amountUsd: 20, payment: paid ? 'PAID' : 'PENDING' },
      })
      if (paid) await prisma.payment.create({ data: { bookingId: b.id, venueId: A.venue.id, method: 'CASH', amount: paid } })
      return b.id
    }
    const todayId = await mk(today, 6)
    const recentId = await mk(addDays(today, -3), 6, 20) // 3 days ago, paid
    const oldId = await mk(addDays(today, -30), 6, 20) // 30 days ago, paid
    const owedOldId = await mk(addDays(today, -30), 8) // 30 days ago, unpaid
    const patch = (id: string, body: unknown) => bookingById.PATCH(req('PATCH', '/x', body), p1(id))
    const pay = (id: string, body: unknown) => payments.POST(req('POST', '/x', body), p1(id))
    const create = (date: string, hour: string) => bookings.POST(req('POST', '/api/bookings', { venueId: A.venue.id, courtId: A.court1.id, customer: 'Backfill', source: 'WALK_IN', date, start: hour, end: `${String(Number(hour.slice(0, 2)) + 1).padStart(2, '0')}:00`, amount: 20, overrideHours: true }))

    // Employee: nothing before today, but can collect money owed and check in today
    as(employee.id)
    const empCancel = await patch(recentId, { status: 'CANCELLED' })
    expect(empCancel.status).toBe(403)
    expect((await empCancel.json()).code).toBe('BOOKING_LOCKED')
    expect((await patch(todayId, { date: addDays(today, -1), start: '06:00', end: '07:00' })).status).toBe(403) // can't move into the past
    expect((await create(addDays(today, -1), '06:00')).status).toBe(403)
    expect((await pay(owedOldId, { method: 'CASH', amount: 20 })).status).toBe(201)
    expect((await patch(todayId, { status: 'CHECKED_IN' })).status).toBe(200)

    // Manager: 7-day window
    as(manager.id)
    expect((await pay(recentId, { kind: 'REFUND', method: 'CASH', amount: 5 })).status).toBe(201)
    expect((await patch(recentId, { status: 'CANCELLED' })).status).toBe(200)
    expect((await patch(oldId, { status: 'CANCELLED' })).status).toBe(403)
    expect((await pay(oldId, { kind: 'REFUND', method: 'CASH', amount: 5 })).status).toBe(403)
    expect((await create(addDays(today, -3), '07:00')).status).toBe(201)
    expect((await create(addDays(today, -10), '07:00')).status).toBe(403)

    // Owner: anything — except checking in on a day that isn't today
    as(A.owner.id)
    expect((await pay(oldId, { kind: 'REFUND', method: 'CASH', amount: 5 })).status).toBe(201)
    expect((await patch(oldId, { status: 'CANCELLED', cancelReason: 'Owner correction' })).status).toBe(200)
    const lateCheckIn = await patch(owedOldId, { status: 'CHECKED_IN' })
    expect(lateCheckIn.status).toBe(422)
    expect((await lateCheckIn.json()).code).toBe('CHECKIN_NOT_TODAY')
    expect((await patch(owedOldId, { status: 'COMPLETED' })).status).toBe(200)
  })

  it('saving sports keeps operating hours and court links', async () => {
    as(A.owner.id)
    const hoursBefore = await prisma.operatingHours.count({ where: { venueId: A.venue.id } })
    expect(hoursBefore).toBe(7)
    const res = await sports.POST(req('POST', '/x', { sports: [{ name: 'Pickleball', emoji: '🏓' }, { name: 'Padel' }] }), p1(A.venue.id))
    expect(res.status).toBe(200)
    expect(await prisma.operatingHours.count({ where: { venueId: A.venue.id } })).toBe(hoursBefore)
    expect((await prisma.court.findUniqueOrThrow({ where: { id: A.court1.id } })).sportId).toBe(A.sport.id)
    expect((await prisma.sport.findMany({ where: { venueId: A.venue.id }, orderBy: { name: 'asc' } })).map((s) => s.name)).toEqual(['Padel', 'Pickleball'])
  })
})
