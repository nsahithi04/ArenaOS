// Read-side helpers: filtering and serialising bookings for API responses.

import type { Prisma, PrismaClient } from '@prisma/client'
import { addDays, isLocalDate, localDateOf, localMinutesOf, localRangeToUtc } from './time'
import { BOOKING_SOURCES, BOOKING_STATUSES, PAYMENT_STATUSES } from './validation'

export const bookingSelect = {
  id: true, venueId: true, courtId: true, sportId: true, customer: true, phone: true, email: true, sport: true,
  source: true, startTime: true, endTime: true, amountUsd: true, priceOverridden: true, payment: true, status: true,
  notes: true, cancelledAt: true, cancelReason: true, createdAt: true, updatedAt: true,
  court: { select: { name: true } },
  sportRef: { select: { name: true, emoji: true } },
  payments: { select: { kind: true, amount: true } },
  playerId: true,
  membership: { select: { id: true, plan: { select: { name: true } } } },
} satisfies Prisma.BookingSelect

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>

export function bookingRef(id: string) {
  return id.slice(-6).toUpperCase()
}

export function toBookingDTO(b: BookingRow, tz: string, opts: { includeContact: boolean }) {
  let paid = 0
  let refunded = 0
  for (const p of b.payments) {
    if (p.kind === 'PAYMENT') paid += Number(p.amount)
    else refunded += Number(p.amount)
  }
  const amount = Number(b.amountUsd)
  const net = Math.round((paid - refunded) * 100) / 100
  const endMin = localMinutesOf(b.endTime, tz)
  return {
    id: b.id,
    ref: bookingRef(b.id),
    customer: b.customer,
    phone: opts.includeContact ? b.phone : null,
    email: opts.includeContact ? b.email : null,
    courtId: b.courtId,
    courtName: b.court.name,
    sportId: b.sportId,
    sportName: b.sportRef?.name ?? b.sport ?? null,
    sportEmoji: b.sportRef?.emoji ?? null,
    source: b.source,
    status: b.status,
    payment: b.payment,
    start: b.startTime.toISOString(),
    end: b.endTime.toISOString(),
    date: localDateOf(b.startTime, tz),
    startMin: localMinutesOf(b.startTime, tz),
    endMin: endMin === 0 && localDateOf(b.endTime, tz) !== localDateOf(b.startTime, tz) ? 1440 : endMin,
    durationMin: Math.round((b.endTime.getTime() - b.startTime.getTime()) / 60000),
    amount,
    paid: Math.round(paid * 100) / 100,
    refunded: Math.round(refunded * 100) / 100,
    balance: b.status === 'CANCELLED' ? 0 : Math.max(0, Math.round((amount - net) * 100) / 100),
    priceOverridden: b.priceOverridden,
    notes: b.notes,
    playerId: b.playerId,
    membershipId: b.membership?.id ?? null,
    membershipPlan: b.membership?.plan.name ?? null,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt.toISOString(),
  }
}

export type BookingDTO = ReturnType<typeof toBookingDTO>

export type BookingFilters = {
  from?: string
  to?: string
  courtId?: string
  sportId?: string
  source?: string[]
  status?: string[]
  payment?: string[]
  q?: string
}

function list(param: string | null, allowed: readonly string[]): string[] | undefined {
  if (!param) return undefined
  const vals = param.split(',').filter((v) => allowed.includes(v))
  return vals.length ? vals : undefined
}

export function parseFilters(sp: URLSearchParams): BookingFilters {
  const from = sp.get('from')
  const to = sp.get('to')
  const id = (v: string | null) => (v && /^[a-zA-Z0-9_-]{1,64}$/.test(v) ? v : undefined)
  const q = sp.get('q')?.trim().slice(0, 100)
  return {
    from: isLocalDate(from) ? from : undefined,
    to: isLocalDate(to) ? to : undefined,
    courtId: id(sp.get('courtId')),
    sportId: id(sp.get('sportId')),
    source: list(sp.get('source'), BOOKING_SOURCES),
    status: list(sp.get('status'), BOOKING_STATUSES),
    payment: list(sp.get('payment'), PAYMENT_STATUSES),
    q: q || undefined,
  }
}

export function buildWhere(venueId: string, tz: string, f: BookingFilters, opts: { searchContact: boolean }): Prisma.BookingWhereInput {
  const where: Prisma.BookingWhereInput = { venueId }
  if (f.from || f.to) {
    const from = f.from ?? '1970-01-01'
    const to = f.to ?? addDays(from, 3650)
    const { start, end } = localRangeToUtc(from, to, tz)
    // Bookings that START inside the local date range.
    where.startTime = { gte: start, lt: end }
  }
  if (f.courtId) where.courtId = f.courtId
  if (f.sportId) where.sportId = f.sportId
  if (f.source) where.source = { in: f.source as never }
  if (f.status) where.status = { in: f.status as never }
  if (f.payment) where.payment = { in: f.payment as never }
  if (f.q) {
    const or: Prisma.BookingWhereInput[] = [
      { customer: { contains: f.q, mode: 'insensitive' } },
      { id: { endsWith: f.q.toLowerCase() } },
      { notes: { contains: f.q, mode: 'insensitive' } },
    ]
    if (opts.searchContact) {
      or.push({ phone: { contains: f.q } }, { email: { contains: f.q, mode: 'insensitive' } })
    }
    where.OR = or
  }
  return where
}

export async function findBookings(db: PrismaClient, where: Prisma.BookingWhereInput, page: number, pageSize: number, order: 'asc' | 'desc') {
  const [items, total] = await Promise.all([
    db.booking.findMany({
      where,
      select: bookingSelect,
      orderBy: [{ startTime: order }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.booking.count({ where }),
  ])
  return { items, total }
}
