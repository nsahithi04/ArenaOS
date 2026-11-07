// Booking engine: all writes that affect court availability go through here.
//
// Double-booking protection has two layers:
//  1. Every write that claims or moves a slot runs in a transaction that first
//     takes a per-court advisory lock (pg_advisory_xact_lock), then checks for
//     overlapping bookings / blocks. Concurrent requests for the same court are
//     therefore serialised and the second one sees the first one's row.
//  2. The "Booking_no_overlap" / "CourtBlock_no_overlap" exclusion constraints
//     reject any overlapping row that slips past (e.g. a direct SQL write).

import { Prisma, type PrismaClient } from '@prisma/client'
import { checkOperatingHours, type HoursRow } from './availability'
import { ConflictError, isExclusionViolation, ServiceError } from './errors'
import { quotePrice, type PriceQuote, type PricingRuleInput } from './pricing'
import { formatMinutes, localDateOf, localMinutesOf, todayIn, zonedToUtc } from './time'
import { canChangeBookingOn, canCheckInOn, lockMessage, MANAGER_CORRECTION_DAYS, type LockActor } from './locks'
import {
  derivePaymentStatus,
  type BlockInput,
  type BookingStatusValue,
  type CreateBookingInput,
  type PaymentInput,
  type UpdateBookingInput,
} from './validation'

type Tx = Prisma.TransactionClient

export type VenueConfig = {
  id: string
  name: string
  timezone: string
  currency: string
  courts: { id: string; name: string; sportId: string | null; isActive: boolean; isAvailable: boolean; type: string }[]
  sports: { id: string; name: string; emoji: string | null }[]
  hours: HoursRow[]
  pricing: PricingRuleInput[]
}

export async function loadVenueConfig(db: PrismaClient | Tx, venueId: string): Promise<VenueConfig> {
  const v = await db.venue.findUnique({
    where: { id: venueId },
    select: {
      id: true, name: true, timezone: true, currency: true,
      courts: { select: { id: true, name: true, sportId: true, isActive: true, isAvailable: true, type: true }, orderBy: { name: 'asc' } },
      sports: { select: { id: true, name: true, emoji: true }, orderBy: { name: 'asc' } },
      operatingHours: { select: { sportId: true, day: true, openTime: true, closeTime: true, isClosed: true } },
      pricingRules: { select: { id: true, label: true, sportId: true, courtId: true, days: true, startTime: true, endTime: true, priceUsd: true } },
    },
  })
  if (!v) throw new ServiceError(404, 'NOT_FOUND', 'Venue not found')
  return {
    id: v.id,
    name: v.name,
    timezone: v.timezone,
    currency: v.currency,
    courts: v.courts.map((c) => ({ ...c, type: String(c.type) })),
    sports: v.sports,
    hours: v.operatingHours.map((h) => ({ ...h, day: String(h.day) })),
    pricing: v.pricingRules.map((r) => ({ ...r, priceUsd: r.priceUsd.toString() })),
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function lockCourts(tx: Tx, courtIds: string[]) {
  // Sorted order prevents deadlocks when a reschedule touches two courts.
  for (const id of [...new Set(courtIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'court:' + id}))`
  }
}

async function assertSlotFree(tx: Tx, courtId: string, start: Date, end: Date, tz: string, excludeBookingId?: string) {
  const clash = await tx.booking.findFirst({
    where: {
      courtId,
      status: { not: 'CANCELLED' },
      startTime: { lt: end },
      endTime: { gt: start },
      ...(excludeBookingId && { id: { not: excludeBookingId } }),
    },
    select: { id: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  })
  if (clash) {
    const s = formatMinutes(localMinutesOf(clash.startTime, tz))
    const e = formatMinutes(localMinutesOf(clash.endTime, tz))
    throw new ConflictError(`This court is already booked from ${s} to ${e}.`, {
      conflictType: 'booking',
      conflictBookingId: clash.id,
      start: clash.startTime.toISOString(),
      end: clash.endTime.toISOString(),
    })
  }
  const block = await tx.courtBlock.findFirst({
    where: { courtId, startTime: { lt: end }, endTime: { gt: start } },
    select: { id: true, startTime: true, endTime: true, reason: true },
  })
  if (block) {
    const s = formatMinutes(localMinutesOf(block.startTime, tz))
    const e = formatMinutes(localMinutesOf(block.endTime, tz))
    throw new ConflictError(`This court is blocked${block.reason ? ` (${block.reason})` : ''} from ${s} to ${e}.`, {
      conflictType: 'block',
      blockId: block.id,
      start: block.startTime.toISOString(),
      end: block.endTime.toISOString(),
    })
  }
}

function courtFor(cfg: VenueConfig, courtId: string) {
  const court = cfg.courts.find((c) => c.id === courtId)
  if (!court) throw new ServiceError(404, 'COURT_NOT_FOUND', 'Court not found for this venue')
  if (!court.isActive || !court.isAvailable) throw new ServiceError(422, 'COURT_UNAVAILABLE', `${court.name} is not available for booking`)
  return court
}

function sportFor(cfg: VenueConfig, sportId: string | null) {
  if (!sportId) return null
  const s = cfg.sports.find((x) => x.id === sportId)
  if (!s) throw new ServiceError(422, 'SPORT_NOT_FOUND', 'Sport not found for this venue')
  return s
}

function assertHours(cfg: VenueConfig, sportId: string | null, date: string, startMin: number, endMin: number, override: boolean) {
  if (override) return
  const h = checkOperatingHours(cfg.hours, sportId, date, startMin, endMin)
  if (h.ok) return
  if (h.reason === 'closed') throw new ServiceError(422, 'VENUE_CLOSED', 'The venue is closed for this sport on that day.')
  const window = h.open != null && h.close != null ? ` (open ${formatMinutes(h.open)} – ${formatMinutes(h.close)})` : ''
  throw new ServiceError(422, 'OUTSIDE_HOURS', `This slot is outside operating hours${window}.`)
}

export function priceFor(cfg: VenueConfig, courtId: string, sportId: string | null, date: string, startMin: number, endMin: number): PriceQuote {
  return quotePrice({ rules: cfg.pricing, sportId, courtId, localDate: date, startMin, endMin })
}

function resolvePrice(quote: PriceQuote, manual: number | null): { amount: number; overridden: boolean } {
  if (manual !== null) return { amount: manual, overridden: manual !== quote.total || quote.uncoveredMinutes > 0 }
  if (quote.uncoveredMinutes > 0) {
    throw new ServiceError(422, 'NO_PRICE', 'No pricing rule covers part of this slot. Enter the price manually.', {
      uncoveredMinutes: quote.uncoveredMinutes,
    })
  }
  return { amount: quote.total, overridden: false }
}

async function refreshPaymentStatus(tx: Tx, bookingId: string) {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { amountUsd: true } })
  const sums = await tx.payment.groupBy({ by: ['kind'], where: { bookingId }, _sum: { amount: true } })
  const paid = Number(sums.find((s) => s.kind === 'PAYMENT')?._sum.amount ?? 0)
  const refunded = Number(sums.find((s) => s.kind === 'REFUND')?._sum.amount ?? 0)
  const payment = derivePaymentStatus(Number(b.amountUsd), paid, refunded)
  await tx.booking.update({ where: { id: bookingId }, data: { payment } })
  return { paid, refunded, payment }
}

function wrapConflict(err: unknown): never {
  if (isExclusionViolation(err)) throw new ConflictError('This court was just booked for an overlapping time. Pick another slot.')
  throw err
}

// ─── Create ─────────────────────────────────────────────────────────────────

export async function createBooking(db: PrismaClient, venueId: string, actorId: string, input: CreateBookingInput, actor: LockActor) {
  const cfg = await loadVenueConfig(db, venueId)
  if (!canChangeBookingOn(actor, input.date, todayIn(cfg.timezone))) {
    throw new ServiceError(403, 'BOOKING_LOCKED', actor.canCorrect
      ? `Bookings more than ${MANAGER_CORRECTION_DAYS} days in the past can only be added by the owner.`
      : "Bookings can't be added for past dates. Ask a manager or the owner.")
  }
  const court = courtFor(cfg, input.courtId)
  const sportId = input.sportId ?? court.sportId
  const sport = sportFor(cfg, sportId)
  assertHours(cfg, sportId, input.date, input.startMin, input.endMin, input.overrideHours)

  const start = zonedToUtc(input.date, input.startMin, cfg.timezone)
  const end = zonedToUtc(input.date, input.endMin, cfg.timezone)
  const quote = priceFor(cfg, court.id, sportId, input.date, input.startMin, input.endMin)
  const { amount, overridden } = resolvePrice(quote, input.amount)

  if (input.initialPayment && input.initialPayment.amount > amount) {
    throw new ServiceError(422, 'OVERPAYMENT', 'Payment cannot exceed the booking amount.')
  }

  try {
    return await db.$transaction(async (tx) => {
      await lockCourts(tx, [court.id])
      await assertSlotFree(tx, court.id, start, end, cfg.timezone)
      const booking = await tx.booking.create({
        data: {
          venueId,
          courtId: court.id,
          sportId,
          sport: sport?.name ?? null,
          customer: input.customer,
          phone: input.phone,
          email: input.email,
          source: input.source,
          startTime: start,
          endTime: end,
          amountUsd: new Prisma.Decimal(amount.toFixed(2)),
          priceOverridden: overridden,
          status: input.status,
          payment: amount === 0 ? 'PAID' : 'PENDING',
          notes: input.notes,
          createdById: actorId,
        },
      })
      if (input.initialPayment) {
        await tx.payment.create({
          data: {
            bookingId: booking.id,
            venueId,
            kind: 'PAYMENT',
            method: input.initialPayment.method,
            amount: new Prisma.Decimal(input.initialPayment.amount.toFixed(2)),
            recordedById: actorId,
          },
        })
        await refreshPaymentStatus(tx, booking.id)
      }
      return { id: booking.id, quote }
    })
  } catch (err) {
    wrapConflict(err)
  }
}

// ─── Update / reschedule / status ───────────────────────────────────────────

const TRANSITIONS: Record<BookingStatusValue, BookingStatusValue[]> = {
  PENDING: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED'],
  CONFIRMED: ['PENDING', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'],
  CHECKED_IN: ['CONFIRMED', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['CHECKED_IN'],
  CANCELLED: ['PENDING', 'CONFIRMED'],
}

export function canTransition(from: BookingStatusValue, to: BookingStatusValue): boolean {
  return from === to || TRANSITIONS[from].includes(to)
}

export async function updateBooking(db: PrismaClient, venueId: string, actorId: string, bookingId: string, input: UpdateBookingInput, actor: LockActor) {
  const existing = await db.booking.findFirst({ where: { id: bookingId, venueId } })
  if (!existing) throw new ServiceError(404, 'NOT_FOUND', 'Booking not found')
  const cfg = await loadVenueConfig(db, venueId)
  const tz = cfg.timezone

  const fromStatus = existing.status as BookingStatusValue
  const toStatus = input.status ?? fromStatus
  if (!canTransition(fromStatus, toStatus)) {
    throw new ServiceError(422, 'INVALID_TRANSITION', `A ${fromStatus.toLowerCase().replace('_', ' ')} booking cannot be changed to ${toStatus.toLowerCase().replace('_', ' ')}.`)
  }

  const curDate = localDateOf(existing.startTime, tz)
  const curStart = localMinutesOf(existing.startTime, tz)
  const curEndRaw = localMinutesOf(existing.endTime, tz)
  const curEnd = curEndRaw === 0 && existing.endTime > existing.startTime ? 1440 : curEndRaw

  const scheduleChanged =
    (input.courtId !== undefined && input.courtId !== existing.courtId) ||
    (input.window !== undefined && (input.window.date !== curDate || input.window.startMin !== curStart || input.window.endMin !== curEnd))
  const reinstating = fromStatus === 'CANCELLED' && toStatus !== 'CANCELLED'
  const sportChanged = input.sportId !== undefined && input.sportId !== existing.sportId

  // Past bookings are locked by age (see lib/booking/locks.ts); moving a booking into a locked date is blocked too.
  const today = todayIn(tz)
  if (!canChangeBookingOn(actor, curDate, today)) throw new ServiceError(403, 'BOOKING_LOCKED', lockMessage(actor))
  if (input.window && !canChangeBookingOn(actor, input.window.date, today)) {
    throw new ServiceError(403, 'BOOKING_LOCKED', "You can't move a booking to that past date.")
  }
  if (toStatus === 'CHECKED_IN' && fromStatus !== 'CHECKED_IN' && !canCheckInOn(input.window?.date ?? curDate, today)) {
    throw new ServiceError(422, 'CHECKIN_NOT_TODAY', 'Check-in is only possible on the day of the booking.')
  }

  if (scheduleChanged && (toStatus === 'CANCELLED' || toStatus === 'COMPLETED')) {
    throw new ServiceError(422, 'NOT_RESCHEDULABLE', `A ${toStatus.toLowerCase()} booking cannot be rescheduled.`)
  }

  const courtId = input.courtId ?? existing.courtId
  const date = input.window?.date ?? curDate
  const startMin = input.window?.startMin ?? curStart
  const endMin = input.window?.endMin ?? curEnd
  const sportId = input.sportId !== undefined ? input.sportId : existing.sportId
  const sport = sportFor(cfg, sportId)
  if (scheduleChanged || reinstating) {
    courtFor(cfg, courtId)
    assertHours(cfg, sportId, date, startMin, endMin, input.overrideHours)
  }

  // Price: explicit amount wins; otherwise re-price when the slot/sport changes
  // (unless staff previously set a manual price), or when asked to.
  let amount: number | undefined
  let overridden: boolean | undefined
  if (input.amount !== undefined) {
    const q = priceFor(cfg, courtId, sportId, date, startMin, endMin)
    amount = input.amount
    overridden = input.amount !== q.total || q.uncoveredMinutes > 0
  } else if (input.recalculatePrice || ((scheduleChanged || sportChanged) && !existing.priceOverridden)) {
    const q = priceFor(cfg, courtId, sportId, date, startMin, endMin)
    if (q.uncoveredMinutes > 0) {
      throw new ServiceError(422, 'NO_PRICE', 'No pricing rule covers part of the new slot. Enter the price manually.')
    }
    amount = q.total
    overridden = false
  }

  const start = zonedToUtc(date, startMin, tz)
  const end = zonedToUtc(date, endMin, tz)

  try {
    return await db.$transaction(async (tx) => {
      if (scheduleChanged || reinstating) {
        await lockCourts(tx, [existing.courtId, courtId])
        await assertSlotFree(tx, courtId, start, end, tz, existing.id)
      }
      await tx.booking.update({
        where: { id: existing.id },
        data: {
          ...(input.customer !== undefined && { customer: input.customer }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.source !== undefined && { source: input.source }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.sportId !== undefined && { sportId, sport: sport?.name ?? null }),
          ...(scheduleChanged && { courtId, startTime: start, endTime: end }),
          ...(amount !== undefined && { amountUsd: new Prisma.Decimal(amount.toFixed(2)), priceOverridden: overridden }),
          ...(toStatus !== fromStatus && { status: toStatus }),
          ...(toStatus === 'CANCELLED' && fromStatus !== 'CANCELLED' && { cancelledAt: new Date(), cancelReason: input.cancelReason ?? null }),
          ...(reinstating && { cancelledAt: null, cancelReason: null }),
        },
      })
      if (amount !== undefined) await refreshPaymentStatus(tx, existing.id)
      return { id: existing.id, rescheduled: scheduleChanged, actorId }
    })
  } catch (err) {
    wrapConflict(err)
  }
}

// ─── Payments ───────────────────────────────────────────────────────────────

export async function recordPayment(db: PrismaClient, venueId: string, actorId: string, bookingId: string, input: PaymentInput, actor: LockActor) {
  return db.$transaction(async (tx) => {
    // Lock the booking row so concurrent payments can't both pass the balance check.
    const rows = await tx.$queryRaw<{ id: string; amountUsd: Prisma.Decimal; status: string }[]>`
      SELECT id, "amountUsd", status::text AS status FROM "Booking" WHERE id = ${bookingId} AND "venueId" = ${venueId} FOR UPDATE`
    const b = rows[0]
    if (!b) throw new ServiceError(404, 'NOT_FOUND', 'Booking not found')

    // Refunds rewrite history, so they follow the booking locks. Collecting money owed is always allowed.
    if (input.kind === 'REFUND') {
      const info = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { startTime: true, venue: { select: { timezone: true } } } })
      const tz = info.venue.timezone
      if (!canChangeBookingOn(actor, localDateOf(info.startTime, tz), todayIn(tz))) {
        throw new ServiceError(403, 'BOOKING_LOCKED', actor.canCorrect
          ? `Refunds on bookings older than ${MANAGER_CORRECTION_DAYS} days can only be issued by the owner.`
          : lockMessage(actor))
      }
    }

    const sums = await tx.payment.groupBy({ by: ['kind'], where: { bookingId }, _sum: { amount: true } })
    const paid = Number(sums.find((s) => s.kind === 'PAYMENT')?._sum.amount ?? 0)
    const refunded = Number(sums.find((s) => s.kind === 'REFUND')?._sum.amount ?? 0)
    const net = Math.round((paid - refunded) * 100) / 100
    const amount = Number(b.amountUsd)

    if (input.kind === 'PAYMENT') {
      if (b.status === 'CANCELLED') throw new ServiceError(422, 'BOOKING_CANCELLED', 'Cannot take payment for a cancelled booking.')
      const balance = Math.round((amount - net) * 100) / 100
      if (input.amount > balance) {
        throw new ServiceError(422, 'OVERPAYMENT', balance > 0 ? `Only ${balance.toFixed(2)} is outstanding.` : 'This booking is already fully paid.')
      }
    } else if (input.amount > net) {
      throw new ServiceError(422, 'OVER_REFUND', net > 0 ? `At most ${net.toFixed(2)} can be refunded.` : 'Nothing has been paid on this booking.')
    }

    await tx.payment.create({
      data: {
        bookingId,
        venueId,
        kind: input.kind,
        method: input.method,
        amount: new Prisma.Decimal(input.amount.toFixed(2)),
        note: input.note,
        recordedById: actorId,
      },
    })
    return refreshPaymentStatus(tx, bookingId)
  })
}

// ─── Court blocks (maintenance / unavailable) ───────────────────────────────

export async function createCourtBlock(db: PrismaClient, venueId: string, actorId: string, input: BlockInput) {
  const cfg = await loadVenueConfig(db, venueId)
  const court = cfg.courts.find((c) => c.id === input.courtId)
  if (!court) throw new ServiceError(404, 'COURT_NOT_FOUND', 'Court not found for this venue')
  const start = zonedToUtc(input.date, input.startMin, cfg.timezone)
  const end = zonedToUtc(input.date, input.endMin, cfg.timezone)
  try {
    return await db.$transaction(async (tx) => {
      await lockCourts(tx, [court.id])
      await assertSlotFree(tx, court.id, start, end, cfg.timezone)
      return tx.courtBlock.create({
        data: { venueId, courtId: court.id, startTime: start, endTime: end, reason: input.reason, createdById: actorId },
      })
    })
  } catch (err) {
    wrapConflict(err)
  }
}
