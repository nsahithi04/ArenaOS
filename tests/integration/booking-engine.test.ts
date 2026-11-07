// Service-level tests against the real PostgreSQL schema (gameon_test):
// availability, concurrency, cancellation, rescheduling, pricing, payments.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ConflictError, ServiceError } from '@/lib/booking/errors'
import { createBooking, createCourtBlock, recordPayment, updateBooking } from '@/lib/booking/service'
import { zonedToUtc } from '@/lib/booking/time'
import { bookingInput, DATE, prisma, resetDatabase, seedVenue, TZ } from './fixtures'

const OWNER = { isOwner: true, canCorrect: true }

const enabled = !!process.env.TEST_DB_AVAILABLE
let v: Awaited<ReturnType<typeof seedVenue>>

describe.skipIf(!enabled)('booking engine (database)', () => {
  beforeAll(async () => {
    await resetDatabase()
    v = await seedVenue('alpha')
  })
  beforeEach(async () => {
    await prisma.payment.deleteMany()
    await prisma.courtBlock.deleteMany()
    await prisma.booking.deleteMany()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })

  const create = (o: Partial<Record<string, unknown>> = {}) => createBooking(prisma, v.venue.id, v.owner.id, bookingInput(v.court1.id, o) as never, OWNER)

  it('creates a booking with a server-calculated, timezone-correct price', async () => {
    const r = await create({ startMin: 16 * 60, endMin: 18 * 60 })
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: r!.id } })
    expect(Number(b.amountUsd)).toBe(50) // 1h off-peak @20 + 1h peak @30
    expect(b.priceOverridden).toBe(false)
    expect(b.startTime.toISOString()).toBe(zonedToUtc(DATE, 16 * 60, TZ).toISOString())
    expect(b.startTime.toISOString()).toBe('2030-01-10T21:00:00.000Z') // 4 PM EST
    expect(b.sportId).toBe(v.sport.id) // inferred from court
    expect(b.payment).toBe('PENDING')
  })

  it('creates a walk-in with an upfront cash payment', async () => {
    const r = await create({ source: 'WALK_IN', initialPayment: { amount: 20, method: 'CASH' } })
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: r!.id }, include: { payments: true } })
    expect(b.source).toBe('WALK_IN')
    expect(b.payment).toBe('PAID')
    expect(b.payments).toHaveLength(1)
    expect(b.payments[0]).toMatchObject({ method: 'CASH', kind: 'PAYMENT' })
    expect(Number(b.payments[0].amount)).toBe(20)
  })

  it('rejects a booking on an occupied court with a useful 409', async () => {
    await create()
    const err = await create({ startMin: 10 * 60 + 30, endMin: 11 * 60 + 30 }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('This court is already booked from 10:00 AM to 11:00 AM.')
  })

  it('allows back-to-back bookings and the same slot on another court', async () => {
    await create()
    await expect(create({ startMin: 11 * 60, endMin: 12 * 60 })).resolves.toBeTruthy()
    await expect(createBooking(prisma, v.venue.id, v.owner.id, bookingInput(v.court2.id) as never, OWNER)).resolves.toBeTruthy()
  })

  it('lets exactly one of many simultaneous requests win the slot', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => create({ customer: `Racer ${i}` })))
    const won = attempts.filter((a) => a.status === 'fulfilled')
    const lost = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[]
    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(9)
    for (const l of lost) expect(l.reason).toBeInstanceOf(ConflictError)
    expect(await prisma.booking.count({ where: { courtId: v.court1.id } })).toBe(1)
  })

  it('is backed by the PostgreSQL exclusion constraint even without the app lock', async () => {
    const r = await create()
    // Insert an overlapping row directly in SQL (times derived from the stored row,
    // so no client/session timezone conversion is involved).
    const insertOverlap = () => prisma.$executeRaw`
      INSERT INTO "Booking" (id, "venueId", "courtId", customer, "startTime", "endTime", "amountUsd", "updatedAt")
      SELECT 'raw-' || md5(random()::text), "venueId", "courtId", 'Raw', "startTime" + interval '15 minutes', "endTime" - interval '15 minutes', 10, now()
      FROM "Booking" WHERE id = ${r!.id}`
    const err = await insertOverlap().catch((e) => e)
    expect(String(err?.message ?? err)).toMatch(/23P01|Booking_no_overlap/)

    // ...but once the original is cancelled, the same insert is allowed.
    await prisma.booking.update({ where: { id: r!.id }, data: { status: 'CANCELLED' } })
    await expect(insertOverlap()).resolves.toBe(1)
  })

  it('frees the slot when a booking is cancelled', async () => {
    const r = await create()
    await updateBooking(prisma, v.venue.id, v.owner.id, r!.id, { status: 'CANCELLED', cancelReason: 'Rain', overrideHours: false }, OWNER)
    const cancelled = await prisma.booking.findUniqueOrThrow({ where: { id: r!.id } })
    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancelReason).toBe('Rain')
    expect(cancelled.cancelledAt).not.toBeNull()
    await expect(create({ customer: 'Next in line' })).resolves.toBeTruthy()
  })

  it('will not reinstate a cancelled booking whose slot was taken', async () => {
    const r = await create()
    await updateBooking(prisma, v.venue.id, v.owner.id, r!.id, { status: 'CANCELLED', overrideHours: false }, OWNER)
    await create({ customer: 'Took it' })
    await expect(updateBooking(prisma, v.venue.id, v.owner.id, r!.id, { status: 'CONFIRMED', overrideHours: false }, OWNER)).rejects.toBeInstanceOf(ConflictError)
  })

  it('reschedules with validation and re-pricing', async () => {
    const a = await create()
    await create({ customer: 'Blocker', startMin: 18 * 60, endMin: 19 * 60 })

    // Into an occupied slot → 409, booking unchanged
    await expect(updateBooking(prisma, v.venue.id, v.owner.id, a!.id, { window: { date: DATE, startMin: 18 * 60 + 30, endMin: 19 * 60 + 30 }, overrideHours: false }, OWNER))
      .rejects.toBeInstanceOf(ConflictError)
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: a!.id } })).startTime.toISOString()).toBe(zonedToUtc(DATE, 600, TZ).toISOString())

    // Overlapping its own current slot is fine (excluded from the check)
    await updateBooking(prisma, v.venue.id, v.owner.id, a!.id, { window: { date: DATE, startMin: 10 * 60 + 30, endMin: 11 * 60 + 30 }, overrideHours: false }, OWNER)

    // To a free peak slot on another court → moved and re-priced at peak rate
    await updateBooking(prisma, v.venue.id, v.owner.id, a!.id, { courtId: v.court2.id, window: { date: DATE, startMin: 19 * 60, endMin: 20 * 60 }, overrideHours: false }, OWNER)
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: a!.id } })
    expect(b.courtId).toBe(v.court2.id)
    expect(Number(b.amountUsd)).toBe(30)
  })

  it('enforces operating hours unless explicitly overridden', async () => {
    const err = await create({ startMin: 5 * 60, endMin: 6 * 60 }).catch((e) => e)
    expect(err).toBeInstanceOf(ServiceError)
    expect(err.code).toBe('OUTSIDE_HOURS')
    // Override still needs a price because no rule covers 5–6 AM
    const noPrice = await create({ startMin: 5 * 60, endMin: 6 * 60, overrideHours: true }).catch((e) => e)
    expect(noPrice.code).toBe('NO_PRICE')
    await expect(create({ startMin: 5 * 60, endMin: 6 * 60, overrideHours: true, amount: 15 })).resolves.toBeTruthy()
  })

  it('honours manual price overrides', async () => {
    const r = await create({ amount: 12.5 })
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: r!.id } })
    expect(Number(b.amountUsd)).toBe(12.5)
    expect(b.priceOverridden).toBe(true)
  })

  it('records payments and refunds with balance checks', async () => {
    const r = await create({ startMin: 17 * 60, endMin: 19 * 60 }) // 60.00
    const id = r!.id
    expect((await recordPayment(prisma, v.venue.id, v.owner.id, id, { kind: 'PAYMENT', method: 'UPI', amount: 25, note: null }, OWNER)).payment).toBe('PENDING')
    await expect(recordPayment(prisma, v.venue.id, v.owner.id, id, { kind: 'PAYMENT', method: 'CASH', amount: 40, note: null }, OWNER)).rejects.toMatchObject({ code: 'OVERPAYMENT' })
    expect((await recordPayment(prisma, v.venue.id, v.owner.id, id, { kind: 'PAYMENT', method: 'CASH', amount: 35, note: null }, OWNER)).payment).toBe('PAID')
    await expect(recordPayment(prisma, v.venue.id, v.owner.id, id, { kind: 'REFUND', method: 'CASH', amount: 70, note: null }, OWNER)).rejects.toMatchObject({ code: 'OVER_REFUND' })
    expect((await recordPayment(prisma, v.venue.id, v.owner.id, id, { kind: 'REFUND', method: 'UPI', amount: 60, note: null }, OWNER)).payment).toBe('REFUNDED')
  })

  it('serialises concurrent payments so a booking cannot be overpaid', async () => {
    const r = await create() // 20.00
    const results = await Promise.allSettled(Array.from({ length: 5 }, () =>
      recordPayment(prisma, v.venue.id, v.owner.id, r!.id, { kind: 'PAYMENT', method: 'CASH', amount: 20, note: null }, OWNER)))
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const sum = await prisma.payment.aggregate({ where: { bookingId: r!.id }, _sum: { amount: true } })
    expect(Number(sum._sum.amount)).toBe(20)
  })

  it('maintenance blocks make a court unavailable and cannot cover existing bookings', async () => {
    await createCourtBlock(prisma, v.venue.id, v.owner.id, { courtId: v.court1.id, date: DATE, startMin: 14 * 60, endMin: 16 * 60, reason: 'Resurfacing' })
    const err = await create({ startMin: 15 * 60, endMin: 16 * 60 }).catch((e) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toContain('Resurfacing')
    await create()
    await expect(createCourtBlock(prisma, v.venue.id, v.owner.id, { courtId: v.court1.id, date: DATE, startMin: 10 * 60, endMin: 12 * 60, reason: null })).rejects.toBeInstanceOf(ConflictError)
  })

  it('does not let one venue book another venue\'s court', async () => {
    const other = await seedVenue(`beta${Date.now()}`)
    const err = await createBooking(prisma, v.venue.id, v.owner.id, bookingInput(other.court1.id) as never, OWNER).catch((e) => e)
    expect(err).toMatchObject({ status: 404, code: 'COURT_NOT_FOUND' })
  })
})
