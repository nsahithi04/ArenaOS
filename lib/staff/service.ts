// Staff scheduling, time sheets, payroll and notifications.
//
// Who can do what (resolved from the database, never the client):
//   owner                 everything, everyone
//   team:edit (managers)  schedule / correct time for people they can manage
//                         (employees, i.e. roles without team:edit) and themselves
//   billing + team view   see and pay the people they can manage
//   everyone              their own shifts, clock in/out, their own pay

import { Prisma, type PrismaClient } from '@prisma/client'
import { hasPermission, type VenueAccess } from '@/lib/booking/access'
import { ConflictError, ServiceError } from '@/lib/booking/errors'
import { addDays, formatMinutes, localMinutesOf, localRangeToUtc, zonedToUtc } from '@/lib/booking/time'
import { sendShiftScheduleEmail } from '@/lib/mail'
import { canManageRole } from '@/lib/team/presets'
import { grossPay, minutesWithin } from './payroll'

type Tx = Prisma.TransactionClient
type Db = PrismaClient | Tx
const r2 = (n: number) => Math.round(n * 100) / 100

export type StaffActor = { userId: string; access: VenueAccess }

const memberInclude = { role: { select: { name: true, permissions: true, preset: true } } } as const
type MemberRow = Prisma.VenueMemberGetPayload<{ include: typeof memberInclude }>

function isSelf(actor: StaffActor, m: { userId: string | null }) {
  return !!m.userId && m.userId === actor.userId
}

/** May the actor schedule / edit time for this member? */
export function canManageMember(actor: StaffActor, m: MemberRow) {
  if (actor.access.isOwner) return true
  if (!hasPermission(actor.access, 'team', 'edit')) return false
  return isSelf(actor, m) || canManageRole(actor.access, m.role)
}

/** May the actor see this member's pay? */
export function canSeePay(actor: StaffActor, m: MemberRow) {
  if (actor.access.isOwner || isSelf(actor, m)) return true
  return hasPermission(actor.access, 'billing', 'view') && hasPermission(actor.access, 'team', 'view') && canManageRole(actor.access, m.role)
}

/** May the actor change this member's pay or record payouts? (never their own) */
export function canPay(actor: StaffActor, m: MemberRow) {
  if (actor.access.isOwner) return true
  if (isSelf(actor, m)) return false
  return hasPermission(actor.access, 'billing', 'edit') && hasPermission(actor.access, 'team', 'edit') && canManageRole(actor.access, m.role)
}

export async function getMember(db: Db, venueId: string, memberId: string) {
  const m = await db.venueMember.findFirst({ where: { id: memberId, venueId }, include: memberInclude })
  if (!m) throw new ServiceError(404, 'MEMBER_NOT_FOUND', 'Team member not found')
  return m
}

export async function selfMember(db: Db, venueId: string, userId: string) {
  return db.venueMember.findFirst({ where: { venueId, userId, status: 'active' }, include: memberInclude })
}

async function venueTz(db: Db, venueId: string) {
  return db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { name: true, timezone: true, currency: true } })
}

// ─── Notifications ──────────────────────────────────────────────────────────

export async function notify(db: Db, userId: string | null, venueId: string, n: { title: string; body?: string; link?: string }) {
  if (!userId) return
  await db.notification.create({ data: { userId, venueId, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null } })
}

// ─── Shifts ─────────────────────────────────────────────────────────────────

export type ShiftInput = { memberId: string; date: string; startMin: number; endMin: number; position: string | null; notes: string | null }

async function shiftClash(err: unknown, db: Db, memberId: string, start: Date, end: Date, tz: string, excludeId?: string): Promise<never> {
  const msg = err instanceof Error ? err.message : String(err)
  if (/Shift_no_overlap|23P01/.test(msg)) {
    const other = await db.shift.findFirst({
      where: { memberId, startTime: { lt: end }, endTime: { gt: start }, ...(excludeId && { id: { not: excludeId } }) },
      select: { date: true, startTime: true, endTime: true },
    }).catch(() => null)
    if (other) {
      const day = new Date(`${other.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
      throw new ConflictError(`This person already has a shift on ${day} from ${formatMinutes(localMinutesOf(other.startTime, tz))} to ${formatMinutes(localMinutesOf(other.endTime, tz)) || '12:00 AM'}, which overlaps this one.`)
    }
    throw new ConflictError('This person already has a shift that overlaps that time.')
  }
  throw err
}

export async function createShift(db: PrismaClient, venueId: string, actor: StaffActor, input: ShiftInput) {
  const m = await getMember(db, venueId, input.memberId)
  if (!canManageMember(actor, m)) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can schedule managers.')
  const { timezone } = await venueTz(db, venueId)
  try {
    return await db.shift.create({
      data: {
        venueId, memberId: m.id, date: input.date, startTime: zonedToUtc(input.date, input.startMin, timezone), endTime: zonedToUtc(input.date, input.endMin, timezone),
        position: input.position ?? m.position, notes: input.notes, createdById: actor.userId,
      },
    })
  } catch (err) { return shiftClash(err, db, m.id, zonedToUtc(input.date, input.startMin, timezone), zonedToUtc(input.date, input.endMin, timezone), timezone) }
}

/** Any change turns the shift back into a draft so the person is re-notified on publish. */
export async function updateShift(db: PrismaClient, venueId: string, actor: StaffActor, shiftId: string, input: Partial<ShiftInput>) {
  const s = await db.shift.findFirst({ where: { id: shiftId, venueId }, include: { member: { include: memberInclude } } })
  if (!s) throw new ServiceError(404, 'NOT_FOUND', 'Shift not found')
  if (!canManageMember(actor, s.member)) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can change a manager\'s shifts.')
  let target = s.member
  if (input.memberId && input.memberId !== s.memberId) {
    target = await getMember(db, venueId, input.memberId)
    if (!canManageMember(actor, target)) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can schedule managers.')
  }
  const { timezone } = await venueTz(db, venueId)
  const date = input.date ?? s.date
  const startMin = input.startMin ?? localMinutesOf(s.startTime, timezone)
  const endMinRaw = input.endMin ?? localMinutesOf(s.endTime, timezone)
  const endMin = endMinRaw === 0 ? 1440 : endMinRaw
  try {
    return await db.shift.update({
      where: { id: s.id },
      data: {
        memberId: target.id, date, startTime: zonedToUtc(date, startMin, timezone), endTime: zonedToUtc(date, endMin, timezone),
        ...(input.position !== undefined && { position: input.position }), ...(input.notes !== undefined && { notes: input.notes }),
        published: false, notifiedAt: null,
      },
    })
  } catch (err) { return shiftClash(err, db, target.id, zonedToUtc(date, startMin, timezone), zonedToUtc(date, endMin, timezone), timezone, s.id) }
}

/** Deleting a published shift tells the person straight away. */
export async function deleteShift(db: PrismaClient, venueId: string, actor: StaffActor, shiftId: string) {
  const s = await db.shift.findFirst({ where: { id: shiftId, venueId }, include: { member: { include: memberInclude } } })
  if (!s) throw new ServiceError(404, 'NOT_FOUND', 'Shift not found')
  if (!canManageMember(actor, s.member)) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can change a manager\'s shifts.')
  await db.shift.delete({ where: { id: s.id } })
  if (s.published && s.endTime > new Date()) {
    const v = await venueTz(db, venueId)
    const when = `${dayLabel(s.date)}, ${formatMinutes(localMinutesOf(s.startTime, v.timezone))} – ${formatMinutes(localMinutesOf(s.endTime, v.timezone) || 1440)}`
    await notify(db, s.member.userId, venueId, { title: 'Shift cancelled', body: `Your shift on ${when} has been cancelled.`, link: '/my-shifts' })
    if (s.member.email) {
      await sendShiftScheduleEmail(s.member.email, { name: s.member.name, venueName: v.name, heading: 'Shift cancelled', intro: `your shift on ${when} has been cancelled.`, shifts: [], link: `${process.env.NEXTAUTH_URL ?? ''}/my-shifts` }).catch((e) => console.error('[shift email]', e))
    }
  }
  return { success: true }
}

function dayLabel(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * Publish all draft shifts in [from, to] and notify each affected person with
 * their full published schedule for that range (email + in-app).
 */
export async function publishShifts(db: PrismaClient, venueId: string, actor: StaffActor, from: string, to: string) {
  const v = await venueTz(db, venueId)
  const { start, end } = localRangeToUtc(from, to, v.timezone)
  const drafts = await db.shift.findMany({ where: { venueId, published: false, startTime: { gte: start, lt: end } }, include: { member: { include: memberInclude } } })
  const allowed = drafts.filter((s) => canManageMember(actor, s.member))
  if (!allowed.length) return { published: 0, notified: [] as string[], emailFailed: [] as string[] }
  const now = new Date()
  await db.shift.updateMany({ where: { id: { in: allowed.map((s) => s.id) } }, data: { published: true, notifiedAt: now } })

  const memberIds = [...new Set(allowed.map((s) => s.memberId))]
  const notified: string[] = []
  const emailFailed: string[] = []
  const range = from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`
  for (const memberId of memberIds) {
    const m = allowed.find((s) => s.memberId === memberId)!.member
    const schedule = await db.shift.findMany({ where: { memberId, published: true, startTime: { gte: start, lt: end } }, orderBy: { startTime: 'asc' } })
    const lines = schedule.map((s) => ({
      day: dayLabel(s.date),
      time: `${formatMinutes(localMinutesOf(s.startTime, v.timezone))} – ${formatMinutes(localMinutesOf(s.endTime, v.timezone) || 1440)}`,
      position: s.position,
    }))
    const changed = allowed.filter((s) => s.memberId === memberId).length
    await notify(db, m.userId, venueId, {
      title: `Your shifts for ${range}`,
      body: `${lines.length} shift${lines.length === 1 ? '' : 's'} scheduled (${changed} new or changed). ${lines.map((l) => `${l.day} ${l.time}`).join('; ')}`,
      link: '/my-shifts',
    })
    if (m.email) {
      try {
        await sendShiftScheduleEmail(m.email, { name: m.name, venueName: v.name, heading: `Your shifts for ${range}`, intro: 'here is your schedule. New or changed shifts are included.', shifts: lines, link: `${process.env.NEXTAUTH_URL ?? ''}/my-shifts` })
      } catch (e) {
        console.error('[shift email]', e)
        emailFailed.push(m.name)
      }
    }
    notified.push(m.name)
  }
  return { published: allowed.length, notified, emailFailed }
}

/** Copy every shift from the week starting `fromWeek` into the week starting `toWeek` as drafts. Clashes are skipped. */
export async function copyWeek(db: PrismaClient, venueId: string, actor: StaffActor, fromWeek: string, toWeek: string) {
  const v = await venueTz(db, venueId)
  const { start, end } = localRangeToUtc(fromWeek, addDays(fromWeek, 6), v.timezone)
  const source = await db.shift.findMany({ where: { venueId, startTime: { gte: start, lt: end } }, include: { member: { include: memberInclude } } })
  const offset = Math.round((Date.parse(toWeek) - Date.parse(fromWeek)) / 86400000)
  let created = 0
  let skipped = 0
  for (const s of source) {
    if (!canManageMember(actor, s.member)) { skipped++; continue }
    const date = addDays(s.date, offset)
    const startMin = localMinutesOf(s.startTime, v.timezone)
    const endMin = localMinutesOf(s.endTime, v.timezone) || 1440
    try {
      await db.shift.create({
        data: { venueId, memberId: s.memberId, date, startTime: zonedToUtc(date, startMin, v.timezone), endTime: zonedToUtc(date, endMin, v.timezone), position: s.position, notes: s.notes, createdById: actor.userId },
      })
      created++
    } catch (err) {
      if (/Shift_no_overlap|23P01/.test(String((err as Error).message))) skipped++
      else throw err
    }
  }
  return { created, skipped }
}

// ─── Clock in / out ─────────────────────────────────────────────────────────

export async function clockIn(db: PrismaClient, venueId: string, userId: string, note: string | null) {
  const m = await selfMember(db, venueId, userId)
  if (!m) throw new ServiceError(403, 'NOT_STAFF', 'Only team members can clock in.')
  const now = new Date()
  // Link to the published shift happening now (or starting within the hour)
  const shift = await db.shift.findFirst({
    where: { memberId: m.id, published: true, startTime: { lte: new Date(+now + 60 * 60000) }, endTime: { gt: now } },
    orderBy: { startTime: 'asc' },
  })
  try {
    return await db.timeEntry.create({ data: { venueId, memberId: m.id, shiftId: shift?.id ?? null, clockIn: now, note, createdById: userId } })
  } catch (err) {
    if (/TimeEntry_one_open|P2002|unique/i.test(String((err as Error).message))) throw new ConflictError("You're already clocked in.")
    throw err
  }
}

export async function clockOut(db: PrismaClient, venueId: string, userId: string) {
  const m = await selfMember(db, venueId, userId)
  if (!m) throw new ServiceError(403, 'NOT_STAFF', 'Only team members can clock out.')
  const open = await db.timeEntry.findFirst({ where: { memberId: m.id, clockOut: null } })
  if (!open) throw new ServiceError(422, 'NOT_CLOCKED_IN', "You're not clocked in.")
  const now = new Date()
  // Guard against a sub-second clock-in/out pair violating the time-order check.
  const out = now > open.clockIn ? now : new Date(+open.clockIn + 1000)
  return db.timeEntry.update({ where: { id: open.id }, data: { clockOut: out } })
}

export type TimeEntryInput = { memberId: string; date: string; inMin: number; outMin: number | null; note: string | null }

async function assertNoEntryOverlap(db: Db, memberId: string, start: Date, end: Date | null, excludeId?: string) {
  const clash = await db.timeEntry.findFirst({
    where: {
      memberId, ...(excludeId && { NOT: { id: excludeId } }),
      clockIn: { lt: end ?? new Date(8.64e15) },
      OR: [{ clockOut: null }, { clockOut: { gt: start } }],
    },
  })
  if (clash) throw new ConflictError('This overlaps another time entry for the same person.')
}

/** Manager adds or corrects a time entry. */
export async function saveTimeEntry(db: PrismaClient, venueId: string, actor: StaffActor, input: TimeEntryInput, entryId?: string) {
  const m = await getMember(db, venueId, input.memberId)
  if (!canManageMember(actor, m)) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can edit a manager\'s time.')
  const { timezone } = await venueTz(db, venueId)
  const clockInAt = zonedToUtc(input.date, input.inMin, timezone)
  const clockOutAt = input.outMin != null ? zonedToUtc(input.date, input.outMin, timezone) : null
  if (clockOutAt && clockOutAt <= clockInAt) throw new ServiceError(422, 'TIME_ORDER', 'Clock-out must be after clock-in.')
  if (clockInAt > new Date()) throw new ServiceError(422, 'FUTURE', "Time can't be recorded in the future.")
  await assertNoEntryOverlap(db, m.id, clockInAt, clockOutAt, entryId)
  try {
    if (entryId) {
      const e = await db.timeEntry.findFirst({ where: { id: entryId, venueId } })
      if (!e) throw new ServiceError(404, 'NOT_FOUND', 'Time entry not found')
      return await db.timeEntry.update({ where: { id: e.id }, data: { memberId: m.id, clockIn: clockInAt, clockOut: clockOutAt, note: input.note, manual: true } })
    }
    return await db.timeEntry.create({ data: { venueId, memberId: m.id, clockIn: clockInAt, clockOut: clockOutAt, note: input.note, manual: true, createdById: actor.userId } })
  } catch (err) {
    if (/TimeEntry_one_open|P2002/i.test(String((err as Error).message))) throw new ConflictError('This person already has an open time entry.')
    throw err
  }
}

export async function deleteTimeEntry(db: PrismaClient, venueId: string, actor: StaffActor, entryId: string) {
  const e = await db.timeEntry.findFirst({ where: { id: entryId, venueId }, include: { member: { include: memberInclude } } })
  if (!e) throw new ServiceError(404, 'NOT_FOUND', 'Time entry not found')
  if (!canManageMember(actor, e.member)) throw new ServiceError(403, 'FORBIDDEN', 'Only the owner can edit a manager\'s time.')
  await db.timeEntry.delete({ where: { id: e.id } })
  return { success: true }
}

// ─── Pay & payroll ──────────────────────────────────────────────────────────

export async function updatePay(db: PrismaClient, venueId: string, actor: StaffActor, memberId: string, input: { payType: 'HOURLY' | 'MONTHLY' | null; payRate: number | null; position?: string | null }) {
  const m = await getMember(db, venueId, memberId)
  if (!canPay(actor, m)) throw new ServiceError(403, 'FORBIDDEN', isSelf(actor, m) ? "You can't change your own pay." : 'Only the owner can change a manager\'s pay.')
  if ((input.payType == null) !== (input.payRate == null)) throw new ServiceError(422, 'PAY', 'Set both the pay type and the rate, or neither.')
  return db.venueMember.update({
    where: { id: m.id },
    data: { payType: input.payType, payRate: input.payRate != null ? new Prisma.Decimal(input.payRate.toFixed(2)) : null, ...(input.position !== undefined && { position: input.position }) },
  })
}

export type PayrollRow = {
  memberId: string; name: string; role: string | null; position: string | null; isYou: boolean
  payType: 'HOURLY' | 'MONTHLY' | null; payRate: number | null
  scheduledMinutes: number; workedMinutes: number; onClock: boolean
  gross: number | null; paid: number; balance: number | null; canPay: boolean
}

export async function payrollReport(db: PrismaClient, venueId: string, actor: StaffActor, from: string, to: string, opts: { onlyMemberId?: string } = {}) {
  const v = await venueTz(db, venueId)
  const { start, end } = localRangeToUtc(from, to, v.timezone)
  const members = await db.venueMember.findMany({
    where: { venueId, ...(opts.onlyMemberId ? { id: opts.onlyMemberId } : { status: 'active' }) },
    include: {
      ...memberInclude,
      shifts: { where: { published: true, startTime: { lt: end }, endTime: { gt: start } }, select: { startTime: true, endTime: true } },
      timeEntries: { where: { clockIn: { lt: end }, OR: [{ clockOut: null }, { clockOut: { gt: start } }] }, select: { clockIn: true, clockOut: true } },
      payrollPayouts: { where: { periodStart: { gte: from, lte: to } }, select: { amount: true } },
    },
    orderBy: { name: 'asc' },
  })
  const now = new Date()
  const rows: PayrollRow[] = []
  for (const m of members) {
    if (!canSeePay(actor, m)) continue
    const scheduled = minutesWithin(m.shifts.map((s) => ({ start: s.startTime, end: s.endTime })), start, end, now)
    const worked = minutesWithin(m.timeEntries.map((e) => ({ start: e.clockIn, end: e.clockOut })), start, end, now)
    const rate = m.payRate != null ? Number(m.payRate) : null
    const gross = grossPay(m.payType, rate, worked, from, to)
    const paid = r2(m.payrollPayouts.reduce((s, p) => s + Number(p.amount), 0))
    rows.push({
      memberId: m.id, name: m.name, role: m.role?.name ?? null, position: m.position, isYou: isSelf(actor, m),
      payType: m.payType, payRate: rate, scheduledMinutes: scheduled, workedMinutes: worked, onClock: m.timeEntries.some((e) => !e.clockOut),
      gross, paid, balance: gross != null ? r2(gross - paid) : null, canPay: canPay(actor, m),
    })
  }
  return { from, to, currency: v.currency, rows }
}

export async function recordPayout(db: PrismaClient, venueId: string, actor: StaffActor, memberId: string, input: { periodStart: string; periodEnd: string; amount: number; method: string; note: string | null }) {
  const m = await getMember(db, venueId, memberId)
  if (!canPay(actor, m)) throw new ServiceError(403, 'FORBIDDEN', isSelf(actor, m) ? "You can't record your own pay." : 'Only the owner can pay a manager.')
  if (input.periodEnd < input.periodStart) throw new ServiceError(422, 'PERIOD', 'Period end must be on or after the start.')
  const v = await venueTz(db, venueId)
  const payout = await db.payrollPayout.create({
    data: { venueId, memberId: m.id, periodStart: input.periodStart, periodEnd: input.periodEnd, amount: new Prisma.Decimal(input.amount.toFixed(2)), method: input.method as never, note: input.note, recordedById: actor.userId },
  })
  let amountText = input.amount.toFixed(2)
  try { amountText = new Intl.NumberFormat('en-US', { style: 'currency', currency: v.currency }).format(input.amount) } catch { /* keep plain */ }
  await notify(db, m.userId, venueId, { title: `Payout recorded: ${amountText}`, body: `For ${dayLabel(input.periodStart)} – ${dayLabel(input.periodEnd)}.`, link: '/my-shifts' })
  return payout
}

