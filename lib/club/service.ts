// Memberships, coaching classes and enrolments.
//
// Classes reserve courts by materialising every session as CourtBlock rows
// (classId set). Creation/rescheduling runs in a transaction that takes the same
// per-court advisory locks as the booking engine and checks for clashes first;
// the CourtBlock_no_overlap exclusion constraint backs it up. Cancelling a class
// or shortening its term frees the future sessions.

import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError, isExclusionViolation, ServiceError } from '@/lib/booking/errors'
import { lockCourts } from '@/lib/booking/service'
import { formatMinutes, localMinutesOf, todayIn, zonedToUtc } from '@/lib/booking/time'
import { membershipEndDate, sessionDates } from './schedule'
import type { ClassInput, EnrollInput, PlanInput, PlayerRef, SellMembershipInput } from './validation'

type Tx = Prisma.TransactionClient
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2))
const r2 = (n: number) => Math.round(n * 100) / 100

// ─── Players ────────────────────────────────────────────────────────────────

async function resolvePlayer(tx: Tx, venueId: string, ref: PlayerRef) {
  if ('playerId' in ref) {
    const p = await tx.player.findFirst({ where: { id: ref.playerId, venueId } })
    if (!p) throw new ServiceError(404, 'PLAYER_NOT_FOUND', 'Player not found')
    return p
  }
  return tx.player.create({ data: { venueId, ...ref.newPlayer } })
}

// ─── Plans ──────────────────────────────────────────────────────────────────

async function assertSport(db: PrismaClient | Tx, venueId: string, sportId: string | null | undefined) {
  if (!sportId) return
  const s = await db.sport.findFirst({ where: { id: sportId, venueId }, select: { id: true } })
  if (!s) throw new ServiceError(422, 'SPORT_NOT_FOUND', 'Sport not found for this venue')
}

export async function createPlan(db: PrismaClient, venueId: string, input: Partial<PlanInput>) {
  await assertSport(db, venueId, input.sportId)
  return db.membershipPlan.create({
    data: {
      venueId, name: input.name!, description: input.description ?? null, durationMonths: input.durationMonths!,
      price: dec(input.price!), sportId: input.sportId ?? null, isActive: input.isActive ?? true,
    },
  })
}

export async function updatePlan(db: PrismaClient, venueId: string, planId: string, input: Partial<PlanInput>) {
  const plan = await db.membershipPlan.findFirst({ where: { id: planId, venueId } })
  if (!plan) throw new ServiceError(404, 'NOT_FOUND', 'Plan not found')
  await assertSport(db, venueId, input.sportId)
  // Existing memberships keep the price and dates they were sold with.
  return db.membershipPlan.update({
    where: { id: plan.id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.durationMonths !== undefined && { durationMonths: input.durationMonths }),
      ...(input.price !== undefined && { price: dec(input.price) }),
      ...(input.sportId !== undefined && { sportId: input.sportId }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
  })
}

// ─── Memberships ────────────────────────────────────────────────────────────

export async function sellMembership(db: PrismaClient, venueId: string, actorId: string, input: SellMembershipInput) {
  return db.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.findFirst({ where: { id: input.planId, venueId } })
    if (!plan) throw new ServiceError(404, 'PLAN_NOT_FOUND', 'Plan not found')
    if (!plan.isActive) throw new ServiceError(422, 'PLAN_INACTIVE', 'This plan is no longer offered')
    const price = Number(plan.price)
    if (input.payment && input.payment.amount > price) throw new ServiceError(422, 'OVERPAYMENT', 'Payment cannot exceed the membership price.')

    const player = await resolvePlayer(tx, venueId, input.player)
    const membership = await tx.membership.create({
      data: {
        venueId, playerId: player.id, planId: plan.id, startDate: input.startDate,
        endDate: membershipEndDate(input.startDate, plan.durationMonths), price: plan.price, createdById: actorId,
      },
    })
    if (input.payment) {
      await tx.payment.create({
        data: { venueId, membershipId: membership.id, method: input.payment.method, amount: dec(input.payment.amount), recordedById: actorId },
      })
    }
    return { id: membership.id, playerId: player.id }
  })
}

export async function cancelMembership(db: PrismaClient, venueId: string, membershipId: string) {
  const m = await db.membership.findFirst({ where: { id: membershipId, venueId } })
  if (!m) throw new ServiceError(404, 'NOT_FOUND', 'Membership not found')
  if (m.status === 'CANCELLED') return m
  return db.membership.update({ where: { id: m.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
}

/** Payment toward a membership; cannot exceed what is still owed. */
export async function payMembership(db: PrismaClient, venueId: string, actorId: string, membershipId: string, p: { amount: number; method: string; note: string | null }) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Membership" WHERE id = ${membershipId} AND "venueId" = ${venueId} FOR UPDATE`
    if (!rows.length) throw new ServiceError(404, 'NOT_FOUND', 'Membership not found')
    const m = await tx.membership.findUniqueOrThrow({ where: { id: membershipId }, include: { payments: true } })
    if (m.status === 'CANCELLED') throw new ServiceError(422, 'CANCELLED', 'This membership is cancelled.')
    const due = r2(Number(m.price) - netPaid(m.payments))
    if (p.amount > due) throw new ServiceError(422, 'OVERPAYMENT', due > 0 ? `Only ${due.toFixed(2)} is outstanding.` : 'This membership is already paid.')
    await tx.payment.create({ data: { venueId, membershipId, method: p.method as never, amount: dec(p.amount), note: p.note, recordedById: actorId } })
    return { balance: r2(due - p.amount) }
  })
}

export function netPaid(payments: { kind: string; amount: Prisma.Decimal | number }[]) {
  return r2(payments.reduce((s, p) => s + (p.kind === 'REFUND' ? -1 : 1) * Number(p.amount), 0))
}

export { membershipForBooking } from './membership-check'

// ─── Classes ────────────────────────────────────────────────────────────────

type Session = { date: string; courtId: string; start: Date; end: Date }

function buildSessions(cls: { courtIds: string[]; days: string[]; startMin: number; endMin: number; startDate: string; endDate: string }, tz: string, fromDate: string): Session[] {
  const from = cls.startDate > fromDate ? cls.startDate : fromDate
  if (from > cls.endDate) return []
  const out: Session[] = []
  for (const date of sessionDates(from, cls.endDate, cls.days)) {
    const start = zonedToUtc(date, cls.startMin, tz)
    const end = zonedToUtc(date, cls.endMin, tz)
    for (const courtId of cls.courtIds) out.push({ date, courtId, start, end })
  }
  return out
}

export type SessionConflict = { date: string; courtId: string; courtName: string; what: string; time: string }

async function findConflicts(tx: Tx, venueId: string, sessions: Session[], tz: string, excludeClassId?: string): Promise<SessionConflict[]> {
  if (!sessions.length) return []
  const min = new Date(Math.min(...sessions.map((s) => +s.start)))
  const max = new Date(Math.max(...sessions.map((s) => +s.end)))
  const courtIds = [...new Set(sessions.map((s) => s.courtId))]
  const [bookings, blocks, courts] = await Promise.all([
    tx.booking.findMany({
      where: { venueId, courtId: { in: courtIds }, status: { not: 'CANCELLED' }, startTime: { lt: max }, endTime: { gt: min } },
      select: { courtId: true, startTime: true, endTime: true, customer: true },
    }),
    tx.courtBlock.findMany({
      where: { venueId, courtId: { in: courtIds }, startTime: { lt: max }, endTime: { gt: min }, ...(excludeClassId && { NOT: { classId: excludeClassId } }) },
      select: { courtId: true, startTime: true, endTime: true, reason: true },
    }),
    tx.court.findMany({ where: { id: { in: courtIds } }, select: { id: true, name: true } }),
  ])
  const name = new Map(courts.map((c) => [c.id, c.name]))
  const fmt = (d: Date) => formatMinutes(localMinutesOf(d, tz))
  const out: SessionConflict[] = []
  for (const s of sessions) {
    for (const b of bookings) {
      if (b.courtId === s.courtId && b.startTime < s.end && b.endTime > s.start) {
        out.push({ date: s.date, courtId: s.courtId, courtName: name.get(s.courtId) ?? '', what: `Booking: ${b.customer}`, time: `${fmt(b.startTime)} – ${fmt(b.endTime)}` })
      }
    }
    for (const b of blocks) {
      if (b.courtId === s.courtId && b.startTime < s.end && b.endTime > s.start) {
        out.push({ date: s.date, courtId: s.courtId, courtName: name.get(s.courtId) ?? '', what: b.reason ?? 'Blocked', time: `${fmt(b.startTime)} – ${fmt(b.endTime)}` })
      }
    }
  }
  return out
}

async function validateCourts(db: PrismaClient | Tx, venueId: string, courtIds: string[]) {
  const courts = await db.court.findMany({ where: { id: { in: courtIds }, venueId, isActive: true }, select: { id: true } })
  if (courts.length !== courtIds.length) throw new ServiceError(422, 'COURT_NOT_FOUND', 'One or more courts are not active courts of this venue')
}

/** Replace a class's future sessions (from `fromDate`) with ones matching its current schedule. */
async function writeSessions(tx: Tx, venueId: string, classId: string, cls: Parameters<typeof buildSessions>[0] & { name: string }, tz: string, fromDate: string, skipConflicts: boolean, actorId: string) {
  const sessions = buildSessions(cls, tz, fromDate)
  await lockCourts(tx, [...new Set(cls.courtIds)])
  const fromInstant = zonedToUtc(fromDate, 0, tz)
  await tx.courtBlock.deleteMany({ where: { classId, startTime: { gte: fromInstant } } })
  const conflicts = await findConflicts(tx, venueId, sessions, tz, classId)
  if (conflicts.length && !skipConflicts) {
    throw new ConflictError(`${conflicts.length} session${conflicts.length === 1 ? '' : 's'} clash with existing bookings or blocks.`, { conflicts: conflicts.slice(0, 100) })
  }
  const clash = new Set(conflicts.map((c) => `${c.date}|${c.courtId}`))
  const rows = sessions
    .filter((s) => !clash.has(`${s.date}|${s.courtId}`))
    .map((s) => ({ venueId, courtId: s.courtId, startTime: s.start, endTime: s.end, classId, reason: `Class: ${cls.name}`, createdById: actorId }))
  if (rows.length) await tx.courtBlock.createMany({ data: rows })
  return { sessions: rows.length, skipped: clash.size }
}

function wrap(err: unknown): never {
  if (isExclusionViolation(err)) throw new ConflictError('A court was just booked at one of these times. Try again.')
  throw err
}

export async function createClass(db: PrismaClient, venueId: string, actorId: string, input: ClassInput & { skipConflicts: boolean }) {
  const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })
  await validateCourts(db, venueId, input.courtIds)
  await assertSport(db, venueId, input.sportId)
  const today = todayIn(venue.timezone)
  if (input.endDate < today) throw new ServiceError(422, 'CLASS_IN_PAST', 'The class term has already ended.')
  try {
    return await db.$transaction(async (tx) => {
      const cls = await tx.class.create({
        data: {
          venueId, name: input.name, coachName: input.coachName ?? null, sportId: input.sportId ?? null, courtIds: input.courtIds, days: input.days,
          startMin: input.startMin, endMin: input.endMin, startDate: input.startDate, endDate: input.endDate,
          capacity: input.capacity ?? null, fee: dec(input.fee), feePeriod: input.feePeriod ?? 'MONTH', createdById: actorId,
        },
      })
      const r = await writeSessions(tx, venueId, cls.id, cls, venue.timezone, today, input.skipConflicts, actorId)
      return { id: cls.id, ...r }
    }, { timeout: 20_000 })
  } catch (err) {
    wrap(err)
  }
}

export async function updateClass(db: PrismaClient, venueId: string, actorId: string, classId: string, input: Partial<ClassInput> & { skipConflicts: boolean }) {
  const cls = await db.class.findFirst({ where: { id: classId, venueId } })
  if (!cls) throw new ServiceError(404, 'NOT_FOUND', 'Class not found')
  if (cls.status === 'CANCELLED') throw new ServiceError(422, 'CLASS_CANCELLED', 'This class is cancelled.')
  const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })
  if (input.courtIds) await validateCourts(db, venueId, input.courtIds)
  if (input.sportId !== undefined) await assertSport(db, venueId, input.sportId)

  const next = { ...cls, ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'skipConflicts')) } as typeof cls
  if (next.endDate < next.startDate) throw new ServiceError(422, 'CLASS_DATES', 'End date must be on or after the start date')
  const scheduleChanged = ['courtIds', 'days', 'startMin', 'endMin', 'startDate', 'endDate'].some((k) => k in input && (input as Record<string, unknown>)[k] !== undefined)

  try {
    return await db.$transaction(async (tx) => {
      await tx.class.update({
        where: { id: cls.id },
        data: {
          name: next.name, coachName: next.coachName, sportId: next.sportId, courtIds: next.courtIds, days: next.days,
          startMin: next.startMin, endMin: next.endMin, startDate: next.startDate, endDate: next.endDate,
          capacity: next.capacity, fee: input.fee !== undefined ? dec(input.fee) : cls.fee, feePeriod: next.feePeriod,
        },
      })
      // Past sessions are history; only today onward is rewritten.
      if (scheduleChanged) {
        const r = await writeSessions(tx, venueId, cls.id, next, venue.timezone, todayIn(venue.timezone), input.skipConflicts, actorId)
        return { id: cls.id, ...r }
      }
      if (input.name) await tx.courtBlock.updateMany({ where: { classId: cls.id }, data: { reason: `Class: ${input.name}` } })
      return { id: cls.id, sessions: null, skipped: 0 }
    }, { timeout: 20_000 })
  } catch (err) {
    wrap(err)
  }
}

/** Cancel a class: future sessions are removed so the courts become bookable again. */
export async function cancelClass(db: PrismaClient, venueId: string, classId: string) {
  const cls = await db.class.findFirst({ where: { id: classId, venueId } })
  if (!cls) throw new ServiceError(404, 'NOT_FOUND', 'Class not found')
  const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })
  const from = zonedToUtc(todayIn(venue.timezone), 0, venue.timezone)
  const now = new Date()
  return db.$transaction(async (tx) => {
    await tx.class.update({ where: { id: cls.id }, data: { status: 'CANCELLED' } })
    // Keep sessions that already started today; free everything after now.
    const freed = await tx.courtBlock.deleteMany({ where: { classId: cls.id, startTime: { gte: from > now ? from : now } } })
    return { freedSessions: freed.count }
  })
}

// ─── Enrolments ─────────────────────────────────────────────────────────────

export async function enroll(db: PrismaClient, venueId: string, actorId: string, classId: string, input: EnrollInput) {
  return db.$transaction(async (tx) => {
    // Lock the class row so two enrolments can't both take the last seat.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Class" WHERE id = ${classId} AND "venueId" = ${venueId} FOR UPDATE`
    if (!locked.length) throw new ServiceError(404, 'NOT_FOUND', 'Class not found')
    const cls = await tx.class.findUniqueOrThrow({ where: { id: classId } })
    if (cls.status === 'CANCELLED') throw new ServiceError(422, 'CLASS_CANCELLED', 'This class is cancelled.')
    if (cls.capacity != null) {
      const taken = await tx.enrollment.count({ where: { classId, status: 'ACTIVE' } })
      if (taken >= cls.capacity) throw new ServiceError(409, 'CLASS_FULL', `This class is full (${cls.capacity} students).`)
    }
    const player = await resolvePlayer(tx, venueId, input.player)
    const existing = await tx.enrollment.findUnique({ where: { classId_playerId: { classId, playerId: player.id } } })
    if (existing?.status === 'ACTIVE') throw new ServiceError(409, 'ALREADY_ENROLLED', `${player.name} is already in this class.`)
    const enrollment = existing
      ? await tx.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE', withdrawnAt: null } })
      : await tx.enrollment.create({ data: { venueId, classId, playerId: player.id, createdById: actorId } })
    if (input.payment) {
      await tx.payment.create({ data: { venueId, enrollmentId: enrollment.id, method: input.payment.method, amount: dec(input.payment.amount), recordedById: actorId } })
    }
    return { id: enrollment.id, playerId: player.id }
  })
}

export async function withdraw(db: PrismaClient, venueId: string, enrollmentId: string) {
  const e = await db.enrollment.findFirst({ where: { id: enrollmentId, venueId } })
  if (!e) throw new ServiceError(404, 'NOT_FOUND', 'Enrolment not found')
  return db.enrollment.update({ where: { id: e.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } })
}

/** Class fees can be monthly, so payments aren't capped by a single price. */
export async function payEnrollment(db: PrismaClient, venueId: string, actorId: string, enrollmentId: string, p: { amount: number; method: string; note: string | null }) {
  const e = await db.enrollment.findFirst({ where: { id: enrollmentId, venueId } })
  if (!e) throw new ServiceError(404, 'NOT_FOUND', 'Enrolment not found')
  return db.payment.create({ data: { venueId, enrollmentId: e.id, method: p.method as never, amount: dec(p.amount), note: p.note, recordedById: actorId } })
}
