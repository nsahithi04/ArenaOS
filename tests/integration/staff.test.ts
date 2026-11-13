// Staff scheduling, time sheets, payroll and notifications.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) }))
const mail = vi.hoisted(() => ({ sendShiftScheduleEmail: vi.fn(async () => ({})), sendRenewalReminderEmail: vi.fn(), sendInviteEmail: vi.fn(), sendOtpEmail: vi.fn(), sendVerificationEmail: vi.fn() }))
vi.mock('@/lib/mail', () => mail)

import * as staff from '@/app/api/staff/route'
import * as shifts from '@/app/api/staff/shifts/route'
import * as shiftById from '@/app/api/staff/shifts/[id]/route'
import * as publish from '@/app/api/staff/shifts/publish/route'
import * as copyWeek from '@/app/api/staff/shifts/copy-week/route'
import * as timeEntries from '@/app/api/staff/time-entries/route'
import * as payroll from '@/app/api/staff/payroll/route'
import * as pay from '@/app/api/staff/members/[id]/pay/route'
import * as payouts from '@/app/api/staff/members/[id]/payouts/route'
import * as myShifts from '@/app/api/me/shifts/route'
import * as clock from '@/app/api/me/clock/route'
import * as notifications from '@/app/api/notifications/route'
import * as markRead from '@/app/api/notifications/read/route'
import { addDays, startOfMonth, endOfMonth, startOfWeek, todayIn } from '@/lib/booking/time'
import { salaryForPeriod } from '@/lib/staff/payroll'
import { ensurePresetRoles } from '@/lib/team/presets'
import { prisma, resetDatabase, seedVenue } from './fixtures'

const enabled = !!process.env.TEST_DB_AVAILABLE
const as = (id: string | null) => { session.userId = id }
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://t${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const p1 = (id: string) => ({ params: Promise.resolve({ id }) })

let V: Awaited<ReturnType<typeof seedVenue>>
let today: string
type Person = { userId: string; memberId: string }
let manager: Person, manager2: Person, emp: Person, emp2: Person

async function person(venueId: string, roleId: string, name: string): Promise<Person> {
  const email = `${name}@staff.test`
  const u = await prisma.user.create({ data: { email, name } })
  const m = await prisma.venueMember.create({ data: { venueId, userId: u.id, roleId, name, email, status: 'active' } })
  return { userId: u.id, memberId: m.id }
}

describe.skipIf(!enabled)('staff scheduling and payroll', () => {
  beforeAll(async () => {
    await resetDatabase()
    V = await seedVenue('staff')
    today = todayIn(V.venue.timezone)
    await ensurePresetRoles(prisma, V.venue.id)
    const mgrRole = await prisma.venueRole.findFirstOrThrow({ where: { venueId: V.venue.id, preset: 'MANAGER' } })
    const empRole = await prisma.venueRole.findFirstOrThrow({ where: { venueId: V.venue.id, preset: 'EMPLOYEE' } })
    manager = await person(V.venue.id, mgrRole.id, 'mona')
    manager2 = await person(V.venue.id, mgrRole.id, 'max')
    emp = await person(V.venue.id, empRole.id, 'eva')
    emp2 = await person(V.venue.id, empRole.id, 'eli')
  })
  afterAll(async () => { await prisma.$disconnect() })

  const day = () => addDays(today, 2)
  let evaShift: string

  it('managers schedule employees and themselves; no double shifts', async () => {
    as(manager.userId)
    const r = await shifts.POST(req('POST', '/x', { memberId: emp.memberId, date: day(), start: '09:00', end: '13:00', position: 'Front desk' }))
    expect(r.status).toBe(201)
    evaShift = (await r.json()).id
    const clash = await shifts.POST(req('POST', '/x', { memberId: emp.memberId, date: day(), start: '12:00', end: '15:00' }))
    expect(clash.status).toBe(409)
    expect((await clash.json()).error).toContain('already has a shift')
    // Back-to-back is fine
    expect((await shifts.POST(req('POST', '/x', { memberId: emp.memberId, date: day(), start: '13:00', end: '15:00' }))).status).toBe(201)
    expect((await shifts.POST(req('POST', '/x', { memberId: manager.memberId, date: day(), start: '09:00', end: '17:00' }))).status).toBe(201)
    expect((await shifts.POST(req('POST', '/x', { memberId: manager2.memberId, date: day(), start: '09:00', end: '17:00' }))).status).toBe(403)
    expect((await shifts.POST(req('POST', '/x', { memberId: emp.memberId, date: day(), start: '18:00', end: '17:00' }))).status).toBe(400)
    as(emp.userId)
    expect((await shifts.POST(req('POST', '/x', { memberId: emp.memberId, date: day(), start: '18:00', end: '19:00' }))).status).toBe(403)
    expect((await staff.GET(req('GET', '/api/staff'))).status).toBe(403)
  })

  it('drafts stay private until published; publishing notifies each person once', async () => {
    as(emp.userId)
    expect((await (await myShifts.GET()).json()).shifts).toHaveLength(0) // drafts aren't visible
    as(manager.userId)
    const week = startOfWeek(day())
    const before = await (await staff.GET(req('GET', `/api/staff?from=${week}&to=${addDays(week, 6)}`))).json()
    expect(before.drafts).toBe(3)
    expect(before.members.find((m: { id: string }) => m.id === manager2.memberId).canEdit).toBe(false)
    const r = await (await publish.POST(req('POST', '/x', { from: week, to: addDays(week, 6) }))).json()
    expect(r).toMatchObject({ published: 3, emailFailed: [] })
    expect(r.notified.sort()).toEqual(['eva', 'mona'])
    expect(mail.sendShiftScheduleEmail).toHaveBeenCalledWith('eva@staff.test', expect.objectContaining({ shifts: expect.arrayContaining([expect.objectContaining({ position: 'Front desk' })]) }))
    expect((await (await publish.POST(req('POST', '/x', { from: week, to: addDays(week, 6) }))).json()).published).toBe(0)

    as(emp.userId)
    const mine = await (await myShifts.GET()).json()
    expect(mine.shifts.map((s: { startMin: number }) => s.startMin)).toEqual([540, 780])
    const n = await (await notifications.GET()).json()
    expect(n.unread).toBe(1)
    expect(n.items[0]).toMatchObject({ link: '/my-shifts', read: false })
  })

  it('editing a published shift makes it a draft again; deleting one tells the person', async () => {
    as(manager.userId)
    expect((await shiftById.PATCH(req('PATCH', '/x', { start: '10:00', end: '13:00' }), p1(evaShift))).status).toBe(200)
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: evaShift } })).published).toBe(false)
    const other = await prisma.shift.findFirstOrThrow({ where: { memberId: emp.memberId, published: true } })
    expect((await shiftById.DELETE(req('DELETE', '/x'), p1(other.id))).status).toBe(200)
    as(emp.userId)
    const n = await (await notifications.GET()).json()
    expect(n.items[0].title).toBe('Shift cancelled')
    expect((await (await markRead.POST(req('POST', '/x', { all: true }))).json()).marked).toBe(2)
    expect((await (await notifications.GET()).json()).unread).toBe(0)
  })

  it('copies a week as drafts and skips clashes', async () => {
    as(manager.userId)
    const week = startOfWeek(day())
    const next = addDays(week, 7)
    const first = await (await copyWeek.POST(req('POST', '/x', { fromWeek: week, toWeek: next }))).json()
    expect(first.created).toBeGreaterThan(0)
    const again = await (await copyWeek.POST(req('POST', '/x', { fromWeek: week, toWeek: next }))).json()
    expect(again).toEqual({ created: 0, skipped: first.created })
    expect(await prisma.shift.count({ where: { date: { gte: next }, published: true } })).toBe(0)
  })

  it('staff clock in and out; one open entry at a time', async () => {
    as(emp2.userId)
    expect((await clock.POST(req('POST', '/x', { action: 'out' }))).status).toBe(422)
    expect((await clock.POST(req('POST', '/x', { action: 'in' }))).status).toBe(201)
    expect((await clock.POST(req('POST', '/x', { action: 'in' }))).status).toBe(409)
    expect((await (await myShifts.GET()).json()).onClockSince).not.toBeNull()
    as(manager.userId)
    const s = await (await staff.GET(req('GET', '/api/staff'))).json()
    expect(s.members.find((m: { id: string }) => m.id === emp2.memberId).onClockSince).not.toBeNull()
    as(emp2.userId)
    expect((await clock.POST(req('POST', '/x', { action: 'out' }))).status).toBe(200)
    as(V.owner.id)
    expect((await myShifts.GET()).status).toBe(404) // owners aren't on the staff list
  })

  it('managers correct time sheets; overlaps and future time are refused', async () => {
    as(manager.userId)
    const y = addDays(today, -1)
    expect((await timeEntries.POST(req('POST', '/x', { memberId: emp.memberId, date: y, clockIn: '09:00', clockOut: '17:30', note: 'Forgot to clock' }))).status).toBe(201)
    expect((await timeEntries.POST(req('POST', '/x', { memberId: emp.memberId, date: y, clockIn: '17:00', clockOut: '18:00' }))).status).toBe(409)
    expect((await timeEntries.POST(req('POST', '/x', { memberId: emp.memberId, date: addDays(today, 3), clockIn: '09:00', clockOut: '10:00' }))).status).toBe(422)
    expect((await timeEntries.POST(req('POST', '/x', { memberId: manager2.memberId, date: y, clockIn: '09:00', clockOut: '10:00' }))).status).toBe(403)
    const list = await (await timeEntries.GET(req('GET', `/api/staff/time-entries?from=${y}&to=${y}`))).json()
    expect(list.items[0]).toMatchObject({ name: 'eva', minutes: 510, manual: true, canEdit: true })
    as(emp.userId)
    expect((await timeEntries.POST(req('POST', '/x', { memberId: emp.memberId, date: y, clockIn: '06:00', clockOut: '07:00' }))).status).toBe(403)
  })

  it('pay is private by hierarchy; hourly and salary are calculated; payouts notify', async () => {
    // Managers set employees' pay, not managers' (nor their own)
    as(manager.userId)
    expect((await pay.PATCH(req('PATCH', '/x', { payType: 'HOURLY', payRate: 20 }), p1(emp.memberId))).status).toBe(200)
    expect((await pay.PATCH(req('PATCH', '/x', { payType: 'MONTHLY', payRate: 9999 }), p1(manager2.memberId))).status).toBe(403)
    expect((await pay.PATCH(req('PATCH', '/x', { payType: 'MONTHLY', payRate: 9999 }), p1(manager.memberId))).status).toBe(403)
    expect((await pay.PATCH(req('PATCH', '/x', { payType: 'HOURLY' }), p1(emp.memberId))).status).toBe(422)
    as(V.owner.id)
    expect((await pay.PATCH(req('PATCH', '/x', { payType: 'MONTHLY', payRate: 3000 }), p1(manager.memberId))).status).toBe(200)
    expect((await pay.PATCH(req('PATCH', '/x', { payType: 'MONTHLY', payRate: 3500 }), p1(manager2.memberId))).status).toBe(200)

    // Owner sees everyone, with correct maths
    const owner = await (await payroll.GET(req('GET', '/api/staff/payroll?range=month'))).json()
    const eva = owner.rows.find((r: { name: string }) => r.name === 'eva')
    const yIn = addDays(today, -1) >= startOfMonth(today)
    expect(eva).toMatchObject({ payType: 'HOURLY', payRate: 20, workedMinutes: yIn ? 510 : 0, gross: yIn ? 170 : 0 })
    expect(owner.rows.find((r: { name: string }) => r.name === 'mona').gross).toBe(salaryForPeriod(3000, startOfMonth(today), endOfMonth(today)))

    // Managers see employees and themselves, never other managers
    as(manager.userId)
    const mgr = await (await payroll.GET(req('GET', '/api/staff/payroll?range=month'))).json()
    expect(mgr.rows.map((r: { name: string }) => r.name).sort()).toEqual(['eli', 'eva', 'mona'])
    expect(mgr.rows.find((r: { name: string }) => r.name === 'mona')).toMatchObject({ isYou: true, canPay: false })

    // Payout → paid/balance, and the employee is told
    expect((await payouts.POST(req('POST', '/x', { periodStart: startOfMonth(today), periodEnd: endOfMonth(today), amount: 50, method: 'CASH' }), p1(emp.memberId))).status).toBe(201)
    expect((await payouts.POST(req('POST', '/x', { periodStart: startOfMonth(today), periodEnd: endOfMonth(today), amount: 50, method: 'CASH' }), p1(manager2.memberId))).status).toBe(403)
    const after = await (await payroll.GET(req('GET', '/api/staff/payroll?range=month'))).json()
    expect(after.rows.find((r: { name: string }) => r.name === 'eva')).toMatchObject({ paid: 50, balance: (yIn ? 170 : 0) - 50 })
    as(emp.userId)
    expect((await (await notifications.GET()).json()).items[0].title).toBe('Payout recorded: $50.00')
    const mine = await (await myShifts.GET()).json()
    expect(mine.month).toMatchObject({ isYou: true, payRate: 20, paid: 50 })
    expect((await payroll.GET(req('GET', '/api/staff/payroll'))).status).toBe(403)
  })
})
